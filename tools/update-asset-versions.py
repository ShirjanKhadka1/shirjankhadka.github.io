#!/usr/bin/env python3
"""Normalize ?v= cache-buster query strings across all HTML files.

Usage:
    python3 tools/update-asset-versions.py [--check] [--root DIR]

What it does:
    Finds every local .js/.css reference that already carries a ?v= query
    string (src="...js?v=..." / href="...css?v=..."), computes the SHA-1 of
    the referenced file's *content*, and rewrites the version to the first
    8 hex chars of that hash.

Why:
    Hand-maintained ?v= stamps drift: the same file ends up referenced with
    2-3 different version strings on different pages (e.g. chart.css?v=...a
    here, ?v=...b there), so browsers re-download identical bytes and
    editors can't tell which stamp is current. Content hashing guarantees
    identical files share identical ?v= URLs everywhere, and a stamp only
    changes when the file's bytes actually change.

Notes:
    - Only references that ALREADY have ?v= are touched; unversioned
      references are left alone.
    - Paths are resolved relative to each HTML file (/x -> repo root).
    - Missing/unresolvable asset files are reported and skipped, never
      rewritten.
    - Idempotent: a second run changes nothing.
    - Run this after editing any versioned .js/.css, before deploying.

    --check  : report what WOULD change, without writing (exit 1 if dirty).
    --root   : repo root (default: parent of this script's directory).
"""
import hashlib
import os
import re
import sys

REF = re.compile(
    r'(?P<attr>(?:src|href)=")'
    r'(?P<path>[^"]+?\.(?:js|css))'
    r'\?v=(?P<ver>[^"&\s]+)'
    r'(?P<rest>[^"]*")'
)


def sha8(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()[:8]


def resolve(path, html_dir, root):
    if path.startswith(('http://', 'https://', '//', 'data:')):
        return None
    if path.startswith('/'):
        return os.path.normpath(os.path.join(root, path.lstrip('/')))
    return os.path.normpath(os.path.join(html_dir, path))


def main():
    check = '--check' in sys.argv
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if '--root' in sys.argv:
        root = os.path.abspath(sys.argv[sys.argv.index('--root') + 1])

    changed_files = 0
    changed_refs = 0
    missing = set()

    for dirpath, _dirs, files in os.walk(root):
        if '/node_modules' in dirpath or '/.git/' in dirpath:
            continue
        for fn in files:
            if not fn.endswith('.html'):
                continue
            html_path = os.path.join(dirpath, fn)
            html_dir = os.path.dirname(html_path)
            with open(html_path, encoding='utf-8') as f:
                html = f.read()

            def fix(m):
                nonlocal changed_refs
                asset = resolve(m.group('path'), html_dir, root)
                if not asset or not os.path.isfile(asset):
                    if asset:
                        missing.add(os.path.relpath(asset, root))
                    return m.group(0)
                ver = sha8(asset)
                if ver != m.group('ver'):
                    changed_refs += 1
                    return (m.group('attr') + m.group('path') + '?v=' + ver
                            + m.group('rest'))
                return m.group(0)

            new_html = REF.sub(fix, html)
            if new_html != html:
                changed_files += 1
                if not check:
                    with open(html_path, 'w', encoding='utf-8') as f:
                        f.write(new_html)

    print(f'html files {"would change" if check else "changed"}: {changed_files}')
    print(f'refs {"would update" if check else "updated"}: {changed_refs}')
    if missing:
        print('missing assets (skipped):')
        for m in sorted(missing):
            print('  ' + m)
    if check and (changed_files or changed_refs):
        sys.exit(1)


if __name__ == '__main__':
    main()
