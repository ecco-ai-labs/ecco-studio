"""Deploy character voice references (saved clips, palettes, designed voices).

Ships the storage API and audio worker files changed in c43bf39 with the same
hash-checked, idle-only, roll-back-on-failure steps as deploy_audio_delivery.py.
Before staging it checks that every repo module those files import already matches
c43bf39 on the pod; if not it stops and lists them, and --with-deps ships them too.
Restarting the coordinator restarts its CPU worker; other workers (another pod, or a
serverless image) need the audio/ files from the same commit.
"""
import argparse
import hashlib
from pathlib import Path

import deploy_audio_delivery as base

SOURCE_COMMIT = 'c6897dcde7d4146a789036a1a1defefa8e77215a'
MODULE = {
    'audio/audio_queue.py': 'a17ce325c6c2d5689e51caefcf9dc33b79f287434f1a791b42ef34f6a9e3533d',
    'audio/audio_schema.py': '62d4d347ef7569b0071a886ab2b855c3825acc8061e5a31f3572484acae8a6eb',
    'audio/extra_worker.py': 'ab7ac72dcd930834ded1d98c1575496289d0011043e425dfd1557ecc6c4302e6',
    'audio/modern_worker.py': 'bff0a469b746e1ecc9e93dd10de18f5178d2ab562db489d0cf41edec7422c4af',
    'audio/queue_worker.py': '253e0bbbe049f198ca324914ba8fa97fa024d828c86a8fd274adb8738065f40a',
    'audio/voice_refs.py': '0aee994cea3575ea4eccee1064f6aadb2945844e1065dd2e49d906f105c5a6e6',
    'backend/audio_jobs.py': 'ce46f3efc44ff36379e2c4418ad40bf5b8dbe66fa0d50d0151e9dabf2435f8a0',
    'backend/storage_api.py': 'c5063423233fd6772d6e584f9dd4a1b6a6e8a24b938b3a7912133fa5beb4279b',
    'backend/voice_references.py': '6605dd87f782ddaae552419ccafa342a17e1dc29403a9e203cba73e8453d0a1b',
}
DEPENDENCIES = {
    'audio/audio_routing.py': '2c5155779036f487f69f4edff67b4f4cfc2903d98f64fb955b1d897006d81e0f',
    'audio/audio_soundtrack.py': '4d5d13f309ec6141d82c9112f0135bd6e83e257c66ff9c2f515263e98d700d95',
    'audio/audio_worker.py': 'b15e3eebf01b80bcd140e123301e2c9ef915a1dbba74e07fac5e757a4a79bec4',
    'audio/generation_cancel.py': '0ae83ec48e85e538958c59ce2fe28fbcf3daa390abe74c87d376965381b05e3c',
    'audio/model_catalog.json': 'd5400aa52082f80a518b23fc0d1789a9559f0e7a1522ea3d1335cc0a794132a4',
    'audio/preflight_resources.py': '1af03ff3327428ede16e79dd9cef52a17d5a290b0dc217a0e7ce2193e58f62df',
    'audio/sound_schema.py': '29bf33af1f26020bda1ae22184fafd5bf90073ba8d6784900eb8e3a88dbbd15c',
    'audio/svara_codec.py': '52e445b4f39f56819e47c2adeb47c6cdf500d578fa914601e6bcd07eab38f65c',
    'backend/audio_library.py': '74e486be58f6dc1599557874039c280de3cbfaaece928f6d86c9af9ff2922124',
    'backend/audio_preflight.py': '1c698d8f6337750c1855164531eedd25887ddf80ee5b35c05138c9cb367ada7b',
    'backend/audio_stories.py': 'e6b1e47f3f6bd4ca5f3b838a369107af19eb17bd61a2ba1048e95d5dee0c44cb',
    'backend/audio_workflows.py': 'f418fbc62c3d48d228456878ce47251a1c0e0b8750a7cfaca57b39dcf090d107',
    'backend/character_studio.py': 'ce146caecebd05e49f5241dbe78bb9135987f8065eb3ced8b75e49840b1cab8f',
    'backend/ecco_campaigns.py': '2c10008cd2da30eed4c6e9075f2fb2a7cd9a32112d8a90e0e22aea9aa068b62e',
    'backend/ecco_desk.py': '886929fadf3c249b2208e7cb31f989f5e2c42916339f65574ff2d70a0bc4be1d',
    'backend/ecco_desk_chat.py': '418a2902a92fb7c21f546946d68ed5bcce10d8a1e9fd6e5fb64b5be685deef1e',
    'backend/ecco_desk_google_chat.py': '3c8e0f6ecf131a218d7772435e6f53a96fb576aa00ea3061463754126187d41a',
    'backend/ecco_desk_groups.py': 'e8f8431b217db2dfd09abc08b8ef378f10ba79fed41b87c45235d717012192e0',
    'backend/ecco_desk_inbox.py': '6deee58cda259ccd17b02ca6fb59bcb740b761aa2e1559c8a1acb0af0cf78b61',
    'backend/ecco_desk_mail.py': '74dbcd7317e78911adf9c20e1dd85d04be41da9e24acf19617a31cf607e89bde',
    'backend/ecco_desk_replies.py': '148acb4a138215fd33d63e2a9af07c524cc572e3523c49460dbd3b796a70df38',
    'backend/ecco_look_and_feel.py': 'b0be461ffd0948d813350e561ce97d4dbd57326f203ac12024cdbe5137c62115',
    'backend/ecco_releases.py': '2a3d82b2bd9e31a51d54da98606df7ae90bddb40ad3309e552cb1b7f845171fd',
    'backend/frame_editor.py': '6bc6614af4c094a5c7e06ea7bd5c3cf43b24aa4d8627f509b35857e653d763f7',
    'backend/generation_controls.py': '4df67596fa9031f7229dd0805a67ede5fbd84090cca5bf6b47614fee47a4c945',
    'backend/google_signin.py': '29dc5d3a8520593485fc857a089feb251012191d96e0adb82c21a75cfbf08d04',
    'backend/gpu_relay.py': '33200199c05cc30dbb5b0a3e4161d031b2454e63275aa9a6ad956f899b7cc437',
    'backend/library_labels.py': 'fa30eb74e49030e4646aee95bde8e71410abde84308fbcc7eb244b3af7c7f446',
    'backend/library_rename.py': '4b57ad9b1ebdb8968b6147081d7bf281273c7fb007ec43129479348b175be129',
    'backend/news_research.py': '3f4f26a2f7b148173870f9338557af7dfda4a320921030cabdf1e4d6be39701c',
    'backend/openai_assistant.py': '7f5a1189c9cceb10ac9679d57343c0e0fc230fb5f520f6edce05a40cfa9c4c8c',
    'backend/scene_planner.py': '58e3100f42cc07ef540f4490cdc44bfc4b74b05ccae1d3a248bba54b7c8cb720',
    'backend/video_reference_context.py': '8bf67fc3562575939d7ee71893206e59e1e1e90a577c79ebf5a26ba1f7ee381a',
    'backend/web_origins.py': '8b079a5496391ad668c8ba251357ad9ef3ffe0e601926e6027084486e00c8e54',
    'backend/youtube_connection.py': 'eb16ef23d60f5d5a3a82ff1c19746a43ab06193f2d2515be8518a3574c7681ba',
    'migration/legacy/studio.py': 'b8d59a6eda090b829e29ddab373dfeb58f0ef2e13cedde5cf223215c61d7b2fe',
}


def stale_dependencies(app=None):
    app = Path(app or base.APP)
    stale = []
    for name, expected in DEPENDENCIES.items():
        path = app / name
        found = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        if found != expected:
            stale.append(name)
    return stale


def configure(with_deps):
    hashes = dict(MODULE)
    if with_deps:
        # The legacy studio module is checked but never shipped by this script.
        hashes.update({k: v for k, v in DEPENDENCIES.items() if not k.startswith('migration/')})
    base.SOURCE_COMMIT = SOURCE_COMMIT
    base.SOURCE_HASHES = hashes
    return hashes


def prepare(api_pid, worker_pid, with_deps=False):
    stale = stale_dependencies()
    if stale and not with_deps:
        raise RuntimeError('These modules on the pod differ from ' + SOURCE_COMMIT[:7] + ': '
                           + ', '.join(stale) + '. Rerun prepare with --with-deps to ship them too.')
    configure(with_deps)
    base.prepare(api_pid, worker_pid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    pre = sub.add_parser('prepare')
    pre.add_argument('--api-pid', type=int, required=True)
    pre.add_argument('--worker-pid', type=int, required=True)
    pre.add_argument('--with-deps', action='store_true')
    apply = sub.add_parser('activate')
    apply.add_argument('directory', type=Path)
    apply.add_argument('--with-deps', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.api_pid, args.worker_pid, args.with_deps)
    else:
        configure(args.with_deps)
        base.activate(args.directory.resolve())
