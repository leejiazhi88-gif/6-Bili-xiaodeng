import hashlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
import fetch_star_official_valuation as factsheet


class FactsheetCacheTests(unittest.TestCase):
    def test_only_matching_remote_digest_and_verified_local_bytes_skip_download(self):
        content = b'%PDF-verified snapshot'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'snapshot.pdf').write_bytes(content)
            previous = {'meta': {'archive': 'snapshot.pdf', 'sha256': hashlib.sha256(content).hexdigest()}}
            def response(data=b'', **headers):
                result = io.BytesIO(data)
                result.headers = headers
                return result
            def head(etag):
                return response(ETag='"' + etag + '"', **{'Content-Length': str(len(content))})
            digest = hashlib.md5(content).hexdigest()
            with patch.object(factsheet, 'ROOT', root), patch.object(factsheet.urllib.request, 'urlopen', return_value=head(digest)) as call:
                self.assertEqual(factsheet.fetch_factsheet(previous), (content, 'verified_unchanged_archive'))
                self.assertEqual(call.call_count, 1)
                self.assertEqual(call.call_args.args[0].get_method(), 'HEAD')
            # Corrupt local content cannot qualify even when the saved metadata matches.
            (root / 'snapshot.pdf').write_bytes(b'%PDF-corrupt snapshot!')
            with patch.object(factsheet, 'ROOT', root), patch.object(factsheet.urllib.request, 'urlopen', side_effect=[head(digest), response(content)]) as call:
                self.assertEqual(factsheet.fetch_factsheet(previous), (content, 'downloaded'))
                self.assertEqual(call.call_count, 2)
            # A changed remote file must download; a racing mismatch must fail.
            with patch.object(factsheet, 'ROOT', root), patch.object(factsheet.urllib.request, 'urlopen', side_effect=[head('0' * 32), response(content)]):
                with self.assertRaisesRegex(ValueError, 'changed during retrieval'):
                    factsheet.fetch_factsheet(previous)


if __name__ == '__main__':
    unittest.main()
