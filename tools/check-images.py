#!/usr/bin/env python3
"""nepse-media-watch: site-wide image/media hygiene scanner.

Scans the site tree (a clean worktree at origin/main == what GitHub Pages serves)
for broken or missing image references, corrupt image files, and pages missing
og:image. Can auto-fix the one trivially-safe case: a page with NO og:image gets
the brand-default OG inserted (correctness, not redesign).

Usage:
    python3 tools/check-images.py            # report only (local refs only)
    python3 tools/check-images.py --fix      # also auto-insert missing og:image
    python3 tools/check-images.py --remote   # additionally HEAD-probe absolute
                                             # https://shirjankhadka.com.np image URLs
                                             # (off by default: flaky through the proxy)

Exit 0 always; results go to stdout as JSON. Human summary to stderr.
"""
import os, re, sys, json

ROOT = os.path.abspath(os.environ.get("SITE_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".bmp", ".avif")
BRAND_OG = "https://shirjankhadka.com.np/assets/images/nepse-decode-og.jpg"

RE_IMG_SRC   = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
RE_SOURCE    = re.compile(r'<source[^>]+srcset=["\']([^"\']+)["\']', re.I)
RE_LINK_ICON = re.compile(r'<link[^>]+rel=["\'](?:icon|apple-touch-icon|shortcut icon)["\'][^>]*href=["\']([^"\']+)["\']', re.I)
RE_META_OG   = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', re.I)
RE_META_ANY_OG = re.compile(r'<meta[^>]+property=["\']og:image["\']', re.I)
RE_CSS_URL   = re.compile(r'url\(\s*["\']?([^)"\']+)["\']?\s*\)')
RE_OG_TITLE  = re.compile(r'(<meta[^>]+property=["\']og:title["\'][^>]*>)', re.I)
RE_TITLE_END = re.compile(r'(</title>)', re.I)
RE_JS_IMG    = re.compile(r'["\']((?:/|assets/|images/|img/|logos/)[^"\']+\.(?:png|jpg|jpeg|webp|gif|svg|ico)(?:\?[^"\']*)?)["\']', re.I)

def norm(p):
    p = (p or "").strip()
    if not p or p.startswith(("data:", "blob:", "javascript:", "#")):
        return None
    return (p.split("?")[0].split("#")[0] or None)

def resolve_local(ref, basedir):
    r = norm(ref)
    if not r or r.startswith(("http://", "https://", "//")):
        return None
    if r.startswith("/"):
        return os.path.join(ROOT, r.lstrip("/"))
    return os.path.normpath(os.path.join(basedir, r))

def main():
    do_fix = "--fix" in sys.argv
    do_remote = "--remote" in sys.argv
    broken, fixed, remote_broken = [], [], []
    og_missing_pages = []
    scanned = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", ".github")]
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
            if ext in ("html", "htm"):
                basedir = os.path.dirname(p)
                try:
                    with open(p, encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                except Exception:
                    continue
                scanned += 1
                refs = RE_IMG_SRC.findall(txt) + RE_LINK_ICON.findall(txt) + RE_META_OG.findall(txt)
                for ss in RE_SOURCE.findall(txt):
                    refs += [s.strip().split(" ")[0] for s in ss.split(",")]
                for ref in refs:
                    tgt = resolve_local(ref, basedir)
                    if tgt is None:
                        if do_remote and ref.strip().startswith("https://shirjankhadka.com.np/"):
                            import urllib.request
                            try:
                                req = urllib.request.Request(ref.strip(), method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
                                with urllib.request.urlopen(req, timeout=15) as resp:
                                    ok = resp.status < 400
                            except Exception:
                                ok = False
                            if not ok:
                                remote_broken.append({"page": os.path.relpath(p, ROOT), "ref": ref})
                        continue
                    if not tgt.lower().endswith(IMG_EXT):
                        continue
                    if not os.path.isfile(tgt):
                        broken.append({"page": os.path.relpath(p, ROOT), "ref": ref,
                                       "resolved": os.path.relpath(tgt, ROOT)})
                # missing og:image -> auto-fix with brand default
                if not RE_META_ANY_OG.search(txt):
                    og_missing_pages.append(os.path.relpath(p, ROOT))
                    if do_fix:
                        tag = ('<meta property="og:image" content="%s">\n'
                               '<meta property="og:image:width" content="1200">\n'
                               '<meta property="og:image:height" content="630">' % BRAND_OG)
                        m = RE_OG_TITLE.search(txt)
                        if m:
                            txt = txt[:m.end()] + "\n" + tag + txt[m.end():]
                            inserted = True
                        else:
                            m2 = RE_TITLE_END.search(txt)
                            if m2:
                                txt = txt[:m2.end()] + "\n" + tag + txt[m2.end():]
                                inserted = True
                            else:
                                inserted = False
                        if inserted:
                            with open(p, "w", encoding="utf-8") as f:
                                f.write(txt)
                            fixed.append(os.path.relpath(p, ROOT))
            elif ext == "css":
                basedir = os.path.dirname(p)
                try:
                    with open(p, encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                except Exception:
                    continue
                scanned += 1
                for ref in RE_CSS_URL.findall(txt):
                    tgt = resolve_local(ref, basedir)
                    if tgt and tgt.lower().endswith(IMG_EXT) and not os.path.isfile(tgt):
                        broken.append({"page": os.path.relpath(p, ROOT), "ref": ref,
                                       "resolved": os.path.relpath(tgt, ROOT)})
            elif ext == "js":
                basedir = os.path.dirname(p)
                try:
                    with open(p, encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                except Exception:
                    continue
                for ref in RE_JS_IMG.findall(txt):
                    if "sym.webp" in ref:  # documented template example in a code comment
                        continue
                    tgt = resolve_local(ref, basedir)
                    if tgt and not os.path.isfile(tgt):
                        broken.append({"page": os.path.relpath(p, ROOT), "ref": ref,
                                       "resolved": os.path.relpath(tgt, ROOT)})

    # corrupt-file check
    corrupt = []
    try:
        from PIL import Image
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", ".github")]
            for fn in filenames:
                if fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".avif", ".bmp")):
                    p = os.path.join(dirpath, fn)
                    try:
                        im = Image.open(p); im.verify()
                    except Exception as e:
                        corrupt.append({"file": os.path.relpath(p, ROOT), "error": str(e)[:100]})
    except ImportError:
        corrupt = [{"file": "*", "error": "PIL not installed, skipped"}]

    out = {
        "site_root": ROOT,
        "scanned": scanned,
        "broken_refs": broken,
        "remote_broken": remote_broken,
        "corrupt_files": corrupt,
        "pages_missing_og_image": og_missing_pages,
        "auto_fixed_og_image": fixed,
    }
    print(json.dumps(out, indent=1, ensure_ascii=False))
    print("SCANNED=%d BROKEN_REFS=%d CORRUPT=%d MISSING_OG=%d AUTO_FIXED=%d" % (
        scanned, len(broken), len(corrupt), len(og_missing_pages), len(fixed)), file=sys.stderr)

if __name__ == "__main__":
    main()
