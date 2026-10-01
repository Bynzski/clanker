/** Host Python fragments execute within the transport's bounded scanner. */
export function jsonlScan(spec: {
  store: string;
  identity: string;
  events: string;
  prelude?: string;
  finalize?: string;
  fileTarget?: boolean;
}): string {
  return String.raw`${spec.prelude ?? ''}
for file in files(os.path.join(home, ${JSON.stringify(spec.store)})):
    try:
        events = list(records(file))
        when = os.stat(file, follow_symlinks=False).st_mtime * 1000
    except FileNotFoundError: continue
    sid, cwd, title, model, provider = '', '', '', '', ''
    for event in events:
        kind = event.get('type')
        payload = event.get('payload')
${spec.identity}
        message = event.get('message')
        if isinstance(message, dict):
            content = message.get('content')
            if not title and (message.get('role') == 'user' or kind == 'user') and not event.get('isMeta'):
                if isinstance(content, list): content = '\n'.join(text(part.get('text')) for part in content if isinstance(part, dict) and part.get('type') == 'text')
                value = text(content).strip()
                if not value.startswith(('<command', '<local-command')): title = value[:120]
${spec.events}
${spec.finalize ?? ""}
    emit(harness, sid, cwd, title, when, model, provider, ${spec.fileTarget ? "file" : "None"})
`;
}
