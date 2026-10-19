import unittest
from audio_video_sequence import plan


class PlanTests(unittest.TestCase):
    def test_three_news_shots_keep_complete_audio(self):
        clips=plan([{'seconds':17,'prompt':'Close up'}, {'seconds':21,'prompt':'Pan left'}, {'seconds':13,'prompt':'Wide'}],51)
        self.assertEqual(clips[0]['start'],0)
        self.assertEqual(clips[-1]['end'],51)
        self.assertTrue(all(.2<=c['end']-c['start']<=10 for c in clips))
        self.assertTrue(all(abs(a['end']-b['start'])<1e-9 for a,b in zip(clips,clips[1:])))
        self.assertEqual(sum(c['frames'] for c in clips),51*25)
        self.assertEqual({c['shot'] for c in clips},{0,1,2})

    def test_frame_rounding_never_accumulates_drift(self):
        clips=plan([{'seconds':11.017,'prompt':'Still'}]*20,220.34)
        self.assertEqual(sum(c['frames'] for c in clips),round(220.34*25))

    def test_missing_audio_range_rejected(self):
        with self.assertRaises(ValueError):plan([{'seconds':3,'prompt':'Pan'}],30)
        with self.assertRaises(ValueError):plan([{'seconds':float('nan'),'prompt':'Pan'}],30)
        with self.assertRaises(ValueError):plan([],30)


if __name__=='__main__':unittest.main()
