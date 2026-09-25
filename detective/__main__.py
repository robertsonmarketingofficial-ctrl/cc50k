import argparse
import json
import webbrowser

from .server import serve


def main():
    p = argparse.ArgumentParser(prog="python -m detective", description="Internet Detective: public-records research dashboard")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--host", default="127.0.0.1", help="Keep 127.0.0.1 unless you know you want it on your network")
    p.add_argument("--demo", action="store_true", help="Use built-in fictional data (works offline)")
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--json", metavar="QUERY", help="Print one investigation as JSON instead of starting the server")
    a = p.parse_args()
    if a.json:
        from .investigate import investigate
        from . import demo
        print(json.dumps(investigate(a.json, fetcher=demo.fetcher if a.demo else None, demo=a.demo).to_dict(), indent=2))
        return
    httpd = serve(a.host, a.port, demo=a.demo)
    url = f"http://{a.host}:{a.port}/"
    print(f"Internet Detective running at {url}{'  (DEMO DATA)' if a.demo else ''}  -  Ctrl+C to stop")
    if not a.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


main()
