"""Local-only static server and fixed, read-only Popdex market relay."""
import argparse, json, os, re, threading, time, urllib.request, urllib.parse, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
BASE = Path(__file__).resolve().parent / 'dist'
CACHE = {}; LOCK = threading.Lock()
def upstream(path, ttl):
    with LOCK:
        hit = CACHE.get(path)
        if hit and time.time()-hit[0] < ttl: return hit[1]
        req = urllib.request.Request('https://app.popdex.xyz/web/'+path, headers={'User-Agent':'Mozilla/5.0 (Pairdesk public market data)'})
        with urllib.request.urlopen(req, timeout=18) as response: data=json.load(response)
        if str(data.get('code')) != '200': raise ValueError('Popdex returned an unsuccessful response')
        CACHE[path]=(time.time(),data)
        return data
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(BASE),**kw)
    def log_message(self,format,*args): pass
    def reply(self,status,data):
        body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        host=self.headers.get('Host','')
        if host not in ('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port)):return self.reply(403,{'error':'Local requests only'})
        p=urllib.parse.urlparse(self.path)
        if not p.path.startswith('/api/'):
            return super().do_GET()
        origin=self.headers.get('Origin')
        if origin and origin not in ('http://127.0.0.1:'+str(self.server.server_port),'http://localhost:'+str(self.server.server_port)):return self.reply(403,{'error':'Same-origin requests only'})
        try:
            if p.path=='/api/health': return self.reply(200,{'service':'pairdesk','readOnly':True})
            if p.path=='/api/popdex/symbols': data=upstream('v1/config/symbols',300)
            elif p.path=='/api/popdex/tickers': data=upstream('v1/market/tickers?category=FUTURES&limit=100',30)
            elif p.path=='/api/popdex/candles':
                symbol=urllib.parse.parse_qs(p.query).get('symbol',[''])[0]
                if not re.fullmatch(r'[A-Za-z0-9._-]{1,35}',symbol):return self.reply(400,{'error':'Invalid symbol'})
                symbols=upstream('v1/config/symbols',300)
                if symbol not in {r['symbol'] for r in symbols['data']}: return self.reply(400,{'error':'Unknown Popdex symbol'})
                data=upstream('v1/public/market/candles?'+urllib.parse.urlencode({'category':'FUTURES','symbol':symbol,'interval':'5m','limit':1000}),60)
            else: return self.reply(404,{'error':'Unsupported route'})
            return self.reply(200,data)
        except urllib.error.HTTPError as e:return self.reply(429 if e.code==429 else 502,{'error':'Upstream market service unavailable','status':e.code})
        except Exception:return self.reply(502,{'error':'Unable to retrieve public Popdex data'})
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
    print(f'Pairdesk: http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
