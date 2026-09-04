import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/solastio_theme.dart';
import '../../../core/widgets/brand_mark.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import 'dashboard/dashboard_page.dart';
import 'appointments/appointments_page.dart';
import 'tasks/tasks_page.dart';
import 'chat/chat_list_page.dart';
import 'attendance/attendance_page.dart';
import 'roster/roster_page.dart';
import 'leaves/leaves_page.dart';
import 'payroll/payroll_page.dart';
import 'clients/clients_page.dart';
import 'notifications/notifications_page.dart';
import 'settings/settings_page.dart';
import '../../owner/presentation/owner_console_page.dart';

class StaffShell extends ConsumerStatefulWidget {
  const StaffShell({super.key});

  @override
  StaffShellState createState() => StaffShellState();
}

class StaffShellState extends ConsumerState<StaffShell> {
  int _selectedIndex = 0;

  static const _mobileLabels = [
    'Today',
    'Appointments',
    'Tasks',
    'Chat',
    'More',
  ];

  static const _desktopLabels = [
    'Today',
    'Appointments',
    'Tasks',
    'Chat',
    'Attendance',
    'Roster',
    'Leaves',
    'Payroll',
    'Clients',
    'Notifications',
    'Owner',
    'Settings',
  ];

  static const _mobileIcons = [
    Icons.today_outlined,
    Icons.calendar_month_outlined,
    Icons.task_outlined,
    Icons.chat_outlined,
    Icons.more_horiz_outlined,
  ];
  static const _mobileActiveIcons = [
    Icons.today,
    Icons.calendar_month,
    Icons.task,
    Icons.chat,
    Icons.more_horiz,
  ];

  static const _desktopIcons = [
    Icons.today_outlined,
    Icons.calendar_month_outlined,
    Icons.task_outlined,
    Icons.chat_outlined,
    Icons.access_time_outlined,
    Icons.view_week_outlined,
    Icons.event_busy_outlined,
    Icons.payments_outlined,
    Icons.people_outlined,
    Icons.notifications_outlined,
    Icons.admin_panel_settings_outlined,
    Icons.settings_outlined,
  ];
  static const _desktopActiveIcons = [
    Icons.today,
    Icons.calendar_month,
    Icons.task,
    Icons.chat,
    Icons.access_time,
    Icons.view_week,
    Icons.event_busy,
    Icons.payments,
    Icons.people,
    Icons.notifications,
    Icons.admin_panel_settings,
    Icons.settings,
  ];

  Widget _buildPage(int index, bool isMobile) {
    if (isMobile) {
      switch (index) {
        case 0:
          return const DashboardPage();
        case 1:
          return const AppointmentsPage();
        case 2:
          return const TasksPage();
        case 3:
          return const ChatListPage();
        case 4:
          return _MorePage(onSelect: _onMoreSelect);
        default:
          return const DashboardPage();
      }
    }
    return _desktopPage(index);
  }

  Widget _desktopPage(int index) {
    switch (index) {
      case 0:
        return const DashboardPage();
      case 1:
        return const AppointmentsPage();
      case 2:
        return const TasksPage();
      case 3:
        return const ChatListPage();
      case 4:
        return const AttendancePage();
      case 5:
        return const RosterPage();
      case 6:
        return const LeavesPage();
      case 7:
        return const PayrollPage();
      case 8:
        return const ClientsPage();
      case 9:
        return const NotificationsPage();
      case 10:
        return const OwnerConsolePage();
      case 11:
        return const SettingsPage();
      default:
        return const DashboardPage();
    }
  }

  void _onMoreSelect(int i) {
    final page = _desktopPage(5 + i);
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  void _signOut() {
    ref.read(sessionProvider.notifier).logout();
    context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final user = session.user;
    final colors = SolastioTheme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < 600;

        if (isMobile) {
          return Scaffold(
            appBar: AppBar(
              title: const BrandMark(inverse: true),
              backgroundColor: colors.accent,
              foregroundColor: Colors.white,
              actions: [
                IconButton(
                  icon: const Icon(Icons.notifications_outlined),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const NotificationsPage(),
                      ),
                    );
                  },
                ),
                IconButton(icon: const Icon(Icons.logout), onPressed: _signOut),
              ],
            ),
            body: _buildPage(_selectedIndex, true),
            bottomNavigationBar: NavigationBar(
              selectedIndex: _selectedIndex.clamp(0, 4),
              onDestinationSelected: (i) => setState(() => _selectedIndex = i),
              destinations: List.generate(
                _mobileLabels.length,
                (i) => NavigationDestination(
                  icon: Icon(_mobileIcons[i]),
                  selectedIcon: Icon(_mobileActiveIcons[i]),
                  label: _mobileLabels[i],
                ),
              ),
            ),
          );
        }

        return Scaffold(
          body: Row(
            children: [
              NavigationRail(
                selectedIndex: _selectedIndex.clamp(
                  0,
                  _desktopLabels.length - 1,
                ),
                onDestinationSelected: (i) =>
                    setState(() => _selectedIndex = i),
                labelType: NavigationRailLabelType.all,
                leading: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Column(
                    children: [
                      const BrandMark(),
                      const SizedBox(height: 4),
                      Text(
                        user?.name ?? '',
                        style: TextStyle(fontSize: 11, color: colors.muted),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                trailing: Expanded(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: IconButton(
                        icon: Icon(Icons.logout, color: colors.danger),
                        onPressed: _signOut,
                      ),
                    ),
                  ),
                ),
                destinations: List.generate(
                  _desktopLabels.length,
                  (i) => NavigationRailDestination(
                    icon: Icon(_desktopIcons[i]),
                    selectedIcon: Icon(_desktopActiveIcons[i]),
                    label: Text(_desktopLabels[i]),
                  ),
                ),
              ),
              const VerticalDivider(width: 1),
              Expanded(child: _buildPage(_selectedIndex, false)),
            ],
          ),
        );
      },
    );
  }
}

class _MorePage extends StatelessWidget {
  const _MorePage({required this.onSelect});
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    const items = <MapEntry<String, IconData>>[
      MapEntry('Attendance', Icons.access_time),
      MapEntry('Roster', Icons.view_week),
      MapEntry('Leaves', Icons.event_busy),
      MapEntry('Payroll', Icons.payments),
      MapEntry('Clients', Icons.people),
      MapEntry('Notifications', Icons.notifications),
      MapEntry('Owner', Icons.admin_panel_settings),
      MapEntry('Settings', Icons.settings),
    ];
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final entry = items[i];
        return ListTile(
          leading: Icon(entry.value, color: colors.accent),
          title: Text(entry.key),
          trailing: Icon(Icons.chevron_right, color: colors.muted),
          onTap: () => onSelect(i),
        );
      },
    );
  }
}
