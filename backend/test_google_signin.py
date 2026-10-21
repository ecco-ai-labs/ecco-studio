import time
import unittest
from unittest.mock import patch
import google_signin as auth

class GoogleSignInTest(unittest.TestCase):
 def setUp(self):
  auth._challenges.clear();auth._sessions.clear()
 def claims(self,p,**changes):
  return dict({'sub':'123','aud':auth.CLIENT_ID,'iss':'https://accounts.google.com','exp':time.time()+3600,'nonce':p['nonce'],'name':'Test','email':'test@gmail.com'},**changes)
 def sign(self,**changes):
  p=auth.challenge()
  with patch.object(auth,'verifier',return_value=self.claims(p,**changes)):
   return auth.login({'challenge':p['challenge'],'credential':'test-token'})
 def test_all_google_account_types_and_stable_subject(self):
  for email in ('test@gmail.com','test@saazztechnologies.com','test@example.com'):
   result=self.sign(email=email)
   self.assertEqual(result['user']['id'],'google:123')
   self.assertEqual(auth.session('Bearer '+result['session_token'])['user']['email'],email)
 def test_wrong_claims_rejected(self):
  for changes in ({'aud':'wrong'},{'iss':'wrong'},{'nonce':'wrong'},{'exp':0},{'sub':''}):
   with self.assertRaises(auth.AuthError):self.sign(**changes)
 def test_bad_signature_rejected(self):
  p=auth.challenge()
  with patch.object(auth,'verifier',side_effect=ValueError('bad signature')):
   with self.assertRaises(auth.AuthError):auth.login({'challenge':p['challenge'],'credential':'bad'})
 def test_challenge_is_single_use(self):
  p=auth.challenge();body={'challenge':p['challenge'],'credential':'test'}
  with patch.object(auth,'verifier',return_value=self.claims(p)):
   auth.login(body)
   with self.assertRaises(auth.AuthError):auth.login(body)
 def test_expired_challenge(self):
  p=auth.challenge();auth._challenges[p['challenge']]['expires']=0
  with self.assertRaises(auth.AuthError):auth.login({'challenge':p['challenge'],'credential':'test'})
 def test_logout_revokes_session(self):
  result=self.sign();bearer='Bearer '+result['session_token']
  auth.session(bearer,logout=True)
  with self.assertRaises(auth.AuthError):auth.session(bearer)
 def test_expired_session(self):
  result=self.sign()
  for s in auth._sessions.values():s['expires']=0
  with self.assertRaises(auth.AuthError):auth.session('Bearer '+result['session_token'])
 def test_unknown_session_denied(self):
  with self.assertRaises(auth.AuthError):auth.session('Bearer made-up')

if __name__=='__main__':unittest.main()
