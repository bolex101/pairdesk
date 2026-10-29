#!/usr/bin/env python3
import os,pathlib,shlex,subprocess,sys
if os.geteuid()!=0: sys.exit('Run as root.')
if not sys.stdin.isatty(): sys.exit('Run interactively in your SSH terminal.')
dest=input('Channel message link [https://t.me/c/1234567890/2] — press Enter to use it: ').strip() or 'https://t.me/c/1234567890/2'
env=os.environ.copy()
for line in pathlib.Path('/etc/pairdesk/telegram.env').read_text().splitlines():
 line=line.strip()
 if not line or line.startswith('#'): continue
 if line.startswith('export '): line=line[7:]
 key,sep,value=line.partition('=')
 if sep and key in ('TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID'):
  words=shlex.split(value)
  if len(words)!=1: sys.exit('Unexpected Telegram configuration format.')
  env[key]=words[0]
sys.exit(subprocess.run(['/opt/pairdesk/bin/node','/opt/pairdesk/setup-channel.cjs',dest],env=env).returncode)
