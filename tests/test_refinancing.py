import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from legacy_refinancing_ths import HEADERS, parse


def table(rows):
    return '<table><tr>' + ''.join('<th>'+h+'</th>' for h in HEADERS) + '</tr><tbody>' + ''.join('<tr>'+''.join('<td>'+c+'</td>' for c in row) for row in rows) + '</tbody></table>'


class RefinancingTests(unittest.TestCase):
    def test_unclosed_rows_rounding_null_and_current_month(self):
        rows = parse(table([
            ['2026-08', '451.29', '170.08', '276.46', '4.76'],
            ['2026-09', '627.81', '208.80', '419.01', '--'],
            ['2026-10', '50', '--', '50', '--'],
            ['2026-11', '25', '0', '25', '0'],
        ]), '2026-11')
        self.assertEqual(rows['2026-08']['refinanceFund'], 281.21)
        self.assertEqual(rows['2026-09']['refinanceFund'], 419.01)
        self.assertIsNone(rows['2026-09']['rightsFund'])
        self.assertIsNone(rows['2026-10']['refinanceFund'])
        self.assertNotIn('2026-11', rows)

    def test_inconsistent_components_rejected(self):
        with self.assertRaises(ValueError):
            parse(table([['2026-10', '100', '20', '90', '0']]), '2026-11')

    def test_schema_and_empty_response_rejected(self):
        for text in ['<html>upstream unavailable</html>', table([])]:
            with self.assertRaises(ValueError):
                parse(text, '2026-11')


if __name__ == '__main__':
    unittest.main()
