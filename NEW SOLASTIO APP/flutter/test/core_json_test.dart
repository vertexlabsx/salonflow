import 'package:flutter_test/flutter_test.dart';
import 'package:solastio_staff/core/utils/json.dart';
import 'package:solastio_staff/features/owner/data/models/owner_record.dart';

void main() {
  test('Json helpers safely parse common backend shapes', () {
    final map = Json.asMap({
      'name': 'Client',
      'count': 7,
      'enabled': true,
      'items': ['a', 'b'],
    });

    expect(Json.string(map['name']), 'Client');
    expect(Json.integer(map['count']), 7);
    expect(Json.boolean(map['enabled']), true);
    expect(Json.stringList(map['items']), ['a', 'b']);
    expect(Json.asList(null), isEmpty);
  });

  test('OwnerRecord derives generic display fields', () {
    final record = OwnerRecord.fromJson({
      'id': 'rec_1',
      'name': 'Main Branch',
      'status': 'active',
      'phone': '9999999999',
    });

    expect(record.id, 'rec_1');
    expect(record.title, 'Main Branch');
    expect(record.subtitle, '9999999999');
    expect(record.status, 'active');
  });
}
