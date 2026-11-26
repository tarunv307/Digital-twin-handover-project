import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/user.dart';
import '../models/task.dart';
import '../models/submission.dart';
import '../models/handover_note.dart';

class OfflineQueuedAction {
  final String id;
  final String method;
  final String path;
  final Map<String, dynamic> body;
  final String label;
  final DateTime createdAt;

  OfflineQueuedAction({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.label,
    required this.createdAt,
  });
}

class ApiService {
  String baseUrl;
  String? _accessToken;
  final List<OfflineQueuedAction> offlineQueue = [];

  final List<User> _embeddedUsers = [
    User(id: 1, name: 'R. Sundaram (Company Admin)', email: 'admin@example.com', role: 'company_admin', employeeId: 'ADM-001'),
    User(id: 4, name: 'M. Priya (Incoming Shift Operator)', email: 'operator@example.com', role: 'operator', employeeId: 'OPR-301'),
    User(id: 5, name: 'K. Aravind (Outgoing Shift Operator)', email: 'john@example.com', role: 'operator', employeeId: 'EMP-101'),
    User(id: 6, name: 'D. Ramesh (Maintenance Engineer)', email: 'maintenance@example.com', role: 'maintenance_engineer', employeeId: 'MNT-401'),
  ];

  final List<TaskItem> _embeddedTasks = [];
  User? _currentSessionUser;

  ApiService({String? initialBaseUrl})
      : baseUrl = initialBaseUrl ?? (kIsWeb ? 'http://localhost:8000' : 'http://10.0.2.2:8000');

  void setBaseUrl(String newUrl) {
    String trimmed = newUrl.trim();
    if (trimmed.endsWith('/')) {
      trimmed = trimmed.substring(0, trimmed.length - 1);
    }
    baseUrl = trimmed;
  }

  Map<String, String> _getHeaders({bool isJson = true}) {
    final headers = <String, String>{};
    if (isJson) headers['Content-Type'] = 'application/json';
    if (_accessToken != null && _accessToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_accessToken';
    }
    return headers;
  }

  Future<bool> pingServer() async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/health')).timeout(const Duration(seconds: 3));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication (JWT Bearer + Offline Fallback)
  // ---------------------------------------------------------------------------
  Future<User?> login(String email, String password) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/login'),
            headers: _getHeaders(),
            body: jsonEncode({'email': email, 'password': password}),
          )
          .timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        _accessToken = data['access_token'];
        _currentSessionUser = User.fromJson(data['user']);
        return _currentSessionUser;
      }
      if (response.statusCode == 401) {
        throw Exception('Invalid email or password');
      }
    } catch (e) {
      if (e.toString().contains('Invalid email or password')) rethrow;
    }

    // Offline fallback
    final normalizedEmail = email.trim().toLowerCase();
    final matched = _embeddedUsers.firstWhere(
      (u) => u.email.toLowerCase() == normalizedEmail,
      orElse: () => User(id: 999, name: email.split('@').first, email: email, role: 'operator', employeeId: 'OPR-999'),
    );
    if (password.isNotEmpty) {
      _currentSessionUser = matched;
      return _currentSessionUser;
    }
    throw Exception('Invalid password');
  }

  Future<void> logout() async {
    try {
      await http.post(Uri.parse('$baseUrl/api/logout'), headers: _getHeaders()).timeout(const Duration(seconds: 2));
    } catch (_) {}
    _accessToken = null;
    _currentSessionUser = null;
  }

  Future<User?> getCurrentUser() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/api/me'), headers: _getHeaders()).timeout(const Duration(seconds: 2));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['authenticated'] == true && data['user'] != null) {
          _currentSessionUser = User.fromJson(data['user']);
          return _currentSessionUser;
        }
      }
    } catch (_) {}
    return _currentSessionUser;
  }

  // ---------------------------------------------------------------------------
  // PS-032 Industrial Machine Lookup (QR & ID), Ops, & Offline Sync Queue
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> getMachineByQrOrId(String tokenOrId) async {
    final trimmed = tokenOrId.trim();
    final isQr = trimmed.toUpperCase().startsWith('QR-');
    final path = isQr ? '/api/dt/machines/by-qr/${Uri.encodeComponent(trimmed.toUpperCase())}' : '/api/dt/machines/$trimmed';
    final res = await http.get(Uri.parse('$baseUrl$path'), headers: _getHeaders()).timeout(const Duration(seconds: 4));
    if (res.statusCode == 200) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('Machine "$trimmed" not found (${res.statusCode})');
  }

  Future<List<Map<String, dynamic>>> getMachineHandovers(String machineId) async {
    final res = await http
        .get(Uri.parse('$baseUrl/api/ps032/handovers?machine_id=$machineId'), headers: _getHeaders())
        .timeout(const Duration(seconds: 4));
    if (res.statusCode == 200) {
      return (jsonDecode(res.body) as List).cast<Map<String, dynamic>>();
    }
    return [];
  }

  Future<bool> _postOrQueue(String path, Map<String, dynamic> body, String label) async {
    try {
      final res = await http
          .post(
            Uri.parse('$baseUrl$path'),
            headers: _getHeaders(),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 4));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return true; // Synced live
      }
      throw Exception('HTTP ${res.statusCode}: ${res.body}');
    } catch (_) {
      offlineQueue.add(
        OfflineQueuedAction(
          id: DateTime.now().microsecondsSinceEpoch.toString(),
          method: 'POST',
          path: path,
          body: body,
          label: label,
          createdAt: DateTime.now(),
        ),
      );
      return false; // Queued offline
    }
  }

  Future<bool> submitProductionEntry({
    required String machineId,
    required int unitsProduced,
    int rejectUnits = 0,
    double downtimeMinutes = 0,
    String? remarks,
  }) {
    return _postOrQueue(
      '/api/ps032/production',
      {
        'machine_id': machineId,
        'units_produced': unitsProduced,
        'reject_units': rejectUnits,
        'downtime_minutes': downtimeMinutes,
        if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
      },
      'Production ($unitsProduced pcs) on $machineId',
    );
  }

  Future<bool> reportAbnormality({
    required String machineId,
    required String title,
    required String description,
    String severity = 'high',
  }) {
    return _postOrQueue(
      '/api/ps032/abnormalities',
      {
        'machine_id': machineId,
        'title': title,
        'description': description,
        'severity': severity,
      },
      'Abnormality "$title" on $machineId',
    );
  }

  Future<bool> logMaintenanceRemark({
    required String machineId,
    required String summary,
    String maintenanceType = 'corrective',
  }) {
    return _postOrQueue(
      '/api/ps032/maintenance',
      {
        'machine_id': machineId,
        'maintenance_type': maintenanceType,
        'status': 'in_progress',
        'summary': summary,
      },
      'Maintenance "$summary" on $machineId',
    );
  }

  Future<bool> acknowledgeHandover({
    required String handoverId,
    required String remarks,
  }) {
    return _postOrQueue(
      '/api/ps032/handovers/$handoverId/acknowledge',
      {
        'remarks': remarks,
        'condition_confirmed': true,
      },
      'Acknowledge handover $handoverId',
    );
  }

  Future<int> flushOfflineQueue() async {
    if (offlineQueue.isEmpty) return 0;
    int synced = 0;
    final remaining = <OfflineQueuedAction>[];
    for (final item in offlineQueue) {
      try {
        final res = await http
            .post(
              Uri.parse('$baseUrl${item.path}'),
              headers: _getHeaders(),
              body: jsonEncode(item.body),
            )
            .timeout(const Duration(seconds: 4));
        if (res.statusCode >= 200 && res.statusCode < 300) {
          synced++;
        } else {
          remaining.add(item);
        }
      } catch (_) {
        remaining.add(item);
      }
    }
    offlineQueue
      ..clear()
      ..addAll(remaining);
    return synced;
  }

  // ---------------------------------------------------------------------------
  // Existing User / Task / Handover methods preserved for compatibility
  // ---------------------------------------------------------------------------
  Future<List<User>> getUsers({String query = ''}) async {
    try {
      final url = query.isEmpty ? '$baseUrl/api/users' : '$baseUrl/api/users?q=${Uri.encodeComponent(query)}';
      final response = await http.get(Uri.parse(url), headers: _getHeaders()).timeout(const Duration(seconds: 3));
      if (response.statusCode == 200) {
        final List list = jsonDecode(response.body);
        return list.map((u) => User.fromJson(u)).toList();
      }
    } catch (_) {}
    return List.from(_embeddedUsers);
  }

  Future<User> createUser(Map<String, dynamic> userData) async {
    final response = await http.post(Uri.parse('$baseUrl/api/users'), headers: _getHeaders(), body: jsonEncode(userData));
    if (response.statusCode == 201) return User.fromJson(jsonDecode(response.body));
    throw Exception('Failed to create user');
  }

  Future<void> deleteUser(int id) async {
    await http.delete(Uri.parse('$baseUrl/api/users/$id'), headers: _getHeaders());
  }

  Future<List<TaskItem>> getTasks({String? status}) async {
    try {
      final url = status != null ? '$baseUrl/api/tasks?status=$status' : '$baseUrl/api/tasks';
      final response = await http.get(Uri.parse(url), headers: _getHeaders()).timeout(const Duration(seconds: 3));
      if (response.statusCode == 200) {
        final List list = jsonDecode(response.body);
        return list.map((t) => TaskItem.fromJson(t)).toList();
      }
    } catch (_) {}
    return List.from(_embeddedTasks);
  }

  Future<TaskItem> createTask(String title, String description, int? assignedTo) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/tasks'),
      headers: _getHeaders(),
      body: jsonEncode({'title': title, 'description': description, 'assigned_to': assignedTo}),
    );
    if (response.statusCode == 201) return TaskItem.fromJson(jsonDecode(response.body));
    throw Exception('Failed to create task');
  }

  Future<void> submitTaskWork(int taskId, {String? link, File? zipFile}) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/tasks/$taskId/submit'));
    if (_accessToken != null) request.headers['Authorization'] = 'Bearer $_accessToken';
    if (link != null) request.fields['link'] = link;
    if (zipFile != null) request.files.add(await http.MultipartFile.fromPath('file', zipFile.path));
    await request.send();
  }

  Future<void> reviewSubmission(int subId, String status, String? adminNotes) async {
    await http.put(
      Uri.parse('$baseUrl/api/submissions/$subId?status=$status&admin_notes=${Uri.encodeComponent(adminNotes ?? '')}'),
      headers: _getHeaders(),
    );
  }

  Future<Map<String, dynamic>> search(String query) async {
    final response = await http.get(Uri.parse('$baseUrl/api/search?q=${Uri.encodeComponent(query)}'), headers: _getHeaders());
    if (response.statusCode == 200) return jsonDecode(response.body) as Map<String, dynamic>;
    return {'users': [], 'tasks': []};
  }

  Future<HandoverNote> generateShiftNote(String start, String end, String timezone) async {
    final hoRes = await http.post(
      Uri.parse('$baseUrl/api/ps032/handovers/generate'),
      headers: _getHeaders(),
      body: jsonEncode({'machine_id': 'mch-chn-103'}),
    );
    if (hoRes.statusCode == 201) {
      final data = jsonDecode(hoRes.body);
      final grounded = data['grounded_report_json'] as Map<String, dynamic>;
      return HandoverNote.fromJson({'note': grounded}, downloadUrl: '$baseUrl/api/download/${data['pdf_filename']}');
    }
    throw Exception('Failed to generate shift handover');
  }
}
