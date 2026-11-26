import 'dart:io';
import 'package:flutter/foundation.dart';
import '../models/user.dart';
import '../models/task.dart';
import '../models/handover_note.dart';
import '../services/api_service.dart';

class AppProvider with ChangeNotifier {
  final ApiService _api = ApiService();

  User? _currentUser;
  bool _isLoading = false;
  String? _errorMessage;

  List<User> _users = [];
  List<TaskItem> _tasks = [];
  HandoverNote? _currentHandoverNote;
  Map<String, dynamic> _searchResults = {'users': <User>[], 'tasks': <TaskItem>[]};

  // PS-032 Industrial Machine Ops State
  Map<String, dynamic>? _activeMachine;
  List<Map<String, dynamic>> _machineHandovers = [];

  String get serverUrl => _api.baseUrl;
  void setServerUrl(String url) {
    _api.setBaseUrl(url);
    notifyListeners();
  }

  Future<bool> pingServer() => _api.pingServer();

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  List<User> get users => _users;
  List<TaskItem> get tasks => _tasks;
  HandoverNote? get currentHandoverNote => _currentHandoverNote;
  Map<String, dynamic> get searchResults => _searchResults;
  Map<String, dynamic>? get activeMachine => _activeMachine;
  List<Map<String, dynamic>> get machineHandovers => _machineHandovers;
  int get offlineQueueCount => _api.offlineQueue.length;
  List<OfflineQueuedAction> get offlineQueue => _api.offlineQueue;

  bool get isAuthenticated => _currentUser != null;
  bool get isAdmin =>
      _currentUser?.role == 'company_admin' ||
      _currentUser?.role == 'regional_manager' ||
      _currentUser?.role == 'factory_supervisor' ||
      _currentUser?.role == 'admin';

  void _setLoading(bool val) {
    _isLoading = val;
    notifyListeners();
  }

  void _setError(String? err) {
    _errorMessage = err;
    notifyListeners();
  }

  Future<void> checkAuth() async {
    _setLoading(true);
    _currentUser = await _api.getCurrentUser();
    _setLoading(false);
  }

  Future<bool> login(String email, String password) async {
    _setLoading(true);
    _setError(null);
    try {
      _currentUser = await _api.login(email, password);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(e.toString().replaceAll('Exception: ', ''));
      _setLoading(false);
      return false;
    }
  }

  Future<void> logout() async {
    _setLoading(true);
    await _api.logout();
    _currentUser = null;
    _users = [];
    _tasks = [];
    _currentHandoverNote = null;
    _activeMachine = null;
    _setLoading(false);
  }

  Future<void> lookupMachine(String qrOrId) async {
    _setLoading(true);
    _setError(null);
    try {
      _activeMachine = await _api.getMachineByQrOrId(qrOrId);
      _machineHandovers = await _api.getMachineHandovers(_activeMachine!['id']);
    } catch (e) {
      _setError(e.toString().replaceAll('Exception: ', ''));
    } finally {
      _setLoading(false);
    }
  }

  Future<bool> logProduction(int units, int rejects, double downtime, String remarks) async {
    if (_activeMachine == null) return false;
    final synced = await _api.submitProductionEntry(
      machineId: _activeMachine!['id'],
      unitsProduced: units,
      rejectUnits: rejects,
      downtimeMinutes: downtime,
      remarks: remarks,
    );
    if (synced) await lookupMachine(_activeMachine!['id']);
    notifyListeners();
    return synced;
  }

  Future<bool> reportAbnormality(String title, String description, String severity) async {
    if (_activeMachine == null) return false;
    final synced = await _api.reportAbnormality(
      machineId: _activeMachine!['id'],
      title: title,
      description: description,
      severity: severity,
    );
    if (synced) await lookupMachine(_activeMachine!['id']);
    notifyListeners();
    return synced;
  }

  Future<bool> logMaintenance(String summary) async {
    if (_activeMachine == null) return false;
    final synced = await _api.logMaintenanceRemark(
      machineId: _activeMachine!['id'],
      summary: summary,
    );
    if (synced) await lookupMachine(_activeMachine!['id']);
    notifyListeners();
    return synced;
  }

  Future<bool> acknowledgeHandover(String handoverId, String remarks) async {
    final synced = await _api.acknowledgeHandover(handoverId: handoverId, remarks: remarks);
    if (synced && _activeMachine != null) {
      await lookupMachine(_activeMachine!['id']);
    }
    notifyListeners();
    return synced;
  }

  Future<int> syncOfflineQueue() async {
    final count = await _api.flushOfflineQueue();
    if (_activeMachine != null) {
      await lookupMachine(_activeMachine!['id']);
    }
    notifyListeners();
    return count;
  }

  Future<void> fetchUsers({String query = ''}) async {
    _users = await _api.getUsers(query: query);
    notifyListeners();
  }

  Future<bool> createUser(Map<String, dynamic> userData) async {
    try {
      await _api.createUser(userData);
      await fetchUsers();
      return true;
    } catch (e) {
      _setError(e.toString());
      return false;
    }
  }

  Future<void> deleteUser(int id) async {
    await _api.deleteUser(id);
    await fetchUsers();
  }

  Future<void> fetchTasks({String? status}) async {
    _tasks = await _api.getTasks(status: status);
    notifyListeners();
  }

  Future<bool> createTask(String title, String description, int? assignedTo) async {
    await _api.createTask(title, description, assignedTo);
    await fetchTasks();
    return true;
  }

  Future<bool> submitTask(int taskId, {String? link, File? zipFile}) async {
    _setLoading(true);
    await _api.submitTaskWork(taskId, link: link, zipFile: zipFile);
    await fetchTasks();
    _setLoading(false);
    return true;
  }

  Future<bool> reviewSubmission(int subId, String status, String? adminNotes) async {
    await _api.reviewSubmission(subId, status, adminNotes);
    await fetchTasks();
    return true;
  }

  Future<void> performSearch(String query) async {
    if (query.isEmpty) {
      _searchResults = {'users': <User>[], 'tasks': <TaskItem>[]};
      notifyListeners();
      return;
    }
    _searchResults = await _api.search(query);
    notifyListeners();
  }

  Future<bool> generateShiftNote(String start, String end, String timezone) async {
    _setLoading(true);
    try {
      _currentHandoverNote = await _api.generateShiftNote(start, end, timezone);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(e.toString());
      _setLoading(false);
      return false;
    }
  }
}
