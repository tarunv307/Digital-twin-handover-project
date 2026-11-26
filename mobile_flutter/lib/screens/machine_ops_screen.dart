import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';

class MachineOpsScreen extends StatefulWidget {
  const MachineOpsScreen({super.key});

  @override
  State<MachineOpsScreen> createState() => _MachineOpsScreenState();
}

class _MachineOpsScreenState extends State<MachineOpsScreen> {
  final _qrCtrl = TextEditingController(text: 'QR-MCH-103');
  final _unitsCtrl = TextEditingController(text: '146');
  final _abnTitleCtrl = TextEditingController();
  final _maintCtrl = TextEditingController();
  final _ackCtrl = TextEditingController(text: 'Condition verified on shop floor.');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AppProvider>().lookupMachine('QR-MCH-103');
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final machine = provider.activeMachine;
    final state = machine?['state'] as Map<String, dynamic>?;
    final pendingHo = provider.machineHandovers.where((h) => h['status'] == 'pending').toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (provider.offlineQueueCount > 0)
          Card(
            color: Colors.amber.shade50,
            child: ListTile(
              leading: const Icon(Icons.cloud_off, color: Colors.amber),
              title: Text('${provider.offlineQueueCount} offline entries queued'),
              trailing: ElevatedButton(
                onPressed: () async {
                  final synced = await provider.syncOfflineQueue();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Synced $synced queued items')),
                    );
                  }
                },
                child: const Text('Sync Now'),
              ),
            ),
          ),

        // QR / Machine Lookup
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _qrCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Machine QR Token or ID',
                      hintText: 'QR-MCH-103 or mch-chn-103',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  icon: const Icon(Icons.qr_code_scanner, size: 18),
                  label: const Text('Load'),
                  onPressed: () => provider.lookupMachine(_qrCtrl.text),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),

        if (machine != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${machine['code']} — ${machine['name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const SizedBox(height: 4),
                  Text('${machine['factory_name']} • ${machine['line_name']}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 10,
                    children: [
                      Chip(label: Text('Status: ${state?['status'] ?? 'Unknown'}')),
                      Chip(label: Text('OEE: ${state?['oee_pct'] ?? 0}%')),
                      Chip(label: Text('Handover: ${state?['handover_status'] ?? 'complete'}')),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Production Entry
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Log Production Entry', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _unitsCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Units Produced', isDense: true, border: OutlineInputBorder()),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: () async {
                          final live = await provider.logProduction(int.tryParse(_unitsCtrl.text) ?? 0, 0, 0, 'Mobile entry');
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(live ? 'Production synced' : 'Saved offline for sync')),
                            );
                          }
                        },
                        child: const Text('Save'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Abnormality & Maintenance
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Report Abnormality / Maintenance Remark', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _abnTitleCtrl,
                    decoration: const InputDecoration(labelText: 'Abnormality Title', isDense: true, border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 8),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.red.shade700, foregroundColor: Colors.white),
                    onPressed: () async {
                      if (_abnTitleCtrl.text.trim().isEmpty) return;
                      final live = await provider.reportAbnormality(_abnTitleCtrl.text.trim(), _abnTitleCtrl.text.trim(), 'high');
                      _abnTitleCtrl.clear();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(live ? 'Abnormality reported' : 'Queued offline')),
                        );
                      }
                    },
                    child: const Text('Report Abnormality'),
                  ),
                  const Divider(height: 20),
                  TextField(
                    controller: _maintCtrl,
                    decoration: const InputDecoration(labelText: 'Maintenance Remark', isDense: true, border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () async {
                      if (_maintCtrl.text.trim().isEmpty) return;
                      final live = await provider.logMaintenance(_maintCtrl.text.trim());
                      _maintCtrl.clear();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(live ? 'Maintenance remark logged' : 'Queued offline')),
                        );
                      }
                    },
                    child: const Text('Log Maintenance Remark'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Pending Handover Acknowledgement
          if (pendingHo.isNotEmpty)
            Card(
              color: Colors.amber.shade50,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Pending Shift Handover: ${pendingHo.first['id']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${pendingHo.first['previous_shift_name']} -> ${pendingHo.first['incoming_shift_name']}'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _ackCtrl,
                      decoration: const InputDecoration(labelText: 'Acknowledgement Remarks', isDense: true, border: OutlineInputBorder()),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.green.shade700, foregroundColor: Colors.white),
                      onPressed: () async {
                        final live = await provider.acknowledgeHandover(pendingHo.first['id'], _ackCtrl.text.trim());
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(live ? 'Handover acknowledged!' : 'Queued offline')),
                          );
                        }
                      },
                      child: const Text('Acknowledge Handover'),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ],
    );
  }
}

