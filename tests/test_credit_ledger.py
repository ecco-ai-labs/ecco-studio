import tempfile
import unittest
from credit_ledger import CreditLedger

class LedgerTest(unittest.TestCase):
    def test_grant_idle_warning_zero_and_no_double_charge(self):
        with tempfile.NamedTemporaryFile() as f:
            now=[0]
            ledger=CreditLedger(f.name, lambda:now[0])
            self.assertEqual(ledger.heartbeat('verified-A')['balance'],500)
            for minute in range(1,6):
                now[0]=minute*60
                result=ledger.heartbeat('verified-A')
                self.assertEqual(result['balance'],500-minute*100)
                self.assertEqual(ledger.heartbeat('verified-A')['balance'],result['balance'])
                self.assertEqual(result['low'], minute>=4)
            now[0]+=60
            self.assertEqual(ledger.heartbeat('verified-A')['balance'],0)
            self.assertEqual(ledger.heartbeat('verified-B')['balance'],500)
            self.assertEqual(CreditLedger(f.name,lambda:now[0]).heartbeat('verified-A')['balance'],0)

    def test_session_close_and_reopen(self):
        with tempfile.NamedTemporaryFile() as f:
            now=[0];ledger=CreditLedger(f.name,lambda:now[0])
            ledger.heartbeat('A');now[0]=30;ledger.end_session('A')
            now[0]=1000;self.assertEqual(ledger.heartbeat('A')['balance'],500)
            now[0]=1030;self.assertEqual(ledger.heartbeat('A')['balance'],400)

if __name__=='__main__': unittest.main()
