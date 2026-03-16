import { buildExecuteUrl } from '../../src/query/buildExecuteUrl';

describe('buildExecuteUrl', () => {
  it('builds class-level execute URLs without duplicate slashes', () => {
    expect(
      buildExecuteUrl('http://api.example.test/api/', 'Order/', {
        action: 'stats'
      })
    ).toBe('http://api.example.test/api/Order/stats');
  });

  it('builds instance-level URLs and encodes path and query segments', () => {
    const url = buildExecuteUrl('http://api.example.test/api/', 'Order', {
      id: 'A/B',
      action: 'send mail',
      method: 'GET',
      args: {
        year: 2025,
        filter: {
          state: 'draft'
        }
      },
      query: {
        include: 'Customer',
        page: {
          limit: 5
        },
        fields: {
          Order: ['Id', 'ShipName']
        }
      }
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/Order/A%2FB/send%20mail');
    expect(parsed.searchParams.get('include')).toBe('Customer');
    expect(parsed.searchParams.get('page[limit]')).toBe('5');
    expect(parsed.searchParams.get('fields[Order]')).toBe('Id,ShipName');
    expect(parsed.searchParams.get('year')).toBe('2025');
    expect(parsed.searchParams.get('filter[state]')).toBe('draft');
  });
});
