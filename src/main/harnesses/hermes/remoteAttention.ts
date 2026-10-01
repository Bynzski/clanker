import type { HarnessRemoteAttention } from '../types';

export const HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os

def emit(event, **kwargs):
    token = os.environ.get('CLANKER_REMOTE_ATTENTION_TOKEN')
    if not token or os.environ.get('CLANKER_REMOTE_ATTENTION_HARNESS') != 'hermes':
        return
    payload = dict(version=1, token=token, harness='hermes', event=event)
    for source, dest in [('session_id', 'sessionId'), ('turn_id', 'turnId')]:
        if isinstance(kwargs.get(source), str):
            payload[dest] = kwargs[source][:128]
    raw = json.dumps(payload).encode()
    if len(raw) > 2048:
        return
    try:
        fd = os.open('/dev/tty', os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            os.write(fd, b'\\x1b]777;clanker-attention;' + base64.b64encode(raw) + b'\\x07')
        finally:
            os.close(fd)
    except OSError:
        pass

def register(ctx):
    for hook, event in [('pre_llm_call', 'turn_started'), ('post_llm_call', 'turn_completed'),
                        ('pre_approval_request', 'input_requested'), ('post_approval_response', 'input_resolved')]:
        ctx.register_hook(hook, lambda _event=event, **kwargs: emit(_event, **kwargs))
`;

export const remote: HarnessRemoteAttention = {
  requiresNode: false,
  validate: `if (os.environ.get('HERMES_HOME') or os.environ.get('HERMES_PROFILE') or any(a.startswith('--profile') or a == '--ignore-user-config' for a in args)):
    sys.exit('Remote Hermes attention currently requires the default host profile')
`,
  configure: ``,
  plugin: () => ({ parts: ['.hermes', 'plugins', 'clanker-grid-remote-attention'],
    files: { 'plugin.yaml': 'name: clanker-grid-remote-attention\nversion: 1.0.0\ndescription: Clanker SSH lifecycle observer\n', '__init__.py': HERMES_REMOTE_ATTENTION_PLUGIN } }),
  enableCommand: { command: 'hermes', args: ['plugins', 'enable', 'clanker-grid-remote-attention'] },
};
