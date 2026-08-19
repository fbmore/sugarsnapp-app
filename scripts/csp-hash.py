#!/usr/bin/env python3
"""Keep the CSP script-src sha256 in sync with each page's inline <script>.

The site has no build step, so a stale hash is not a build error -- the browser
silently refuses to run the script and the page renders blank. That failure is
invisible to `git diff` and to GitHub Pages, which will happily deploy it.

Usage:
    scripts/csp-hash.py            # rewrite any stale hashes in place
    scripts/csp-hash.py --check    # exit 1 if any page is stale (used by CI)

Only pages whose CSP already pins a sha256 are touched; pages without a CSP
meta tag are left alone.

It also stamps the shared assets. styles/ss.css and scripts/ss-core.js are
served by GitHub Pages with cache-control: max-age=600 and no versioning, so a
page can ship a new hash for its inline script while the browser keeps a
stylesheet ten minutes (or, on a phone that has not been reloaded, hours) out
of date -- which is how the drawer shipped transparent to a device that had
already been shown the fix. Every <link href="styles/..."> and <script
src="scripts/..."> gets ?v=<first 10 hex of the file's sha256>, so the asset
URL changes exactly when the asset does and never otherwise. --check fails on
a stale stamp the same way it fails on a stale hash.
"""
import base64
import glob
import hashlib
import os
import re
import sys

# Inline scripts only: anything with attributes (src=, type=) is not hashed
# by script-src the same way and would need its own handling.
SCRIPT_RE = re.compile(r"<script>(.*?)</script>", re.DOTALL)
# The script-src directive as a whole, so a page can pin more than one script.
CSP_RE = re.compile(r"(<meta http-equiv=\"Content-Security-Policy\"[^>]*?"
                    r"script-src )([^;\"]*)")


# Local shared assets only: same-origin, no scheme. The optional ?v= is what
# this tool owns; anything else about the tag is left alone.
ASSET_RE = re.compile(r'((?:href|src)=")((?:styles|scripts)/[A-Za-z0-9_.-]+)(?:\?v=[0-9a-f]+)?(")')


def asset_stamp(root, rel):
    """?v= value for a shared asset: first 10 hex of its sha256, or None if the
    referenced file does not exist (a broken reference is not ours to mask)."""
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()[:10]


def stamp_assets(root, page):
    """Rewrite every local asset reference to carry its current stamp."""
    def sub(match):
        stamp = asset_stamp(root, match.group(2))
        if stamp is None:
            return match.group(0)
        return "%s%s?v=%s%s" % (match.group(1), match.group(2), stamp, match.group(3))
    return ASSET_RE.sub(sub, page)


def keywords(value):
    """Non-hash tokens in script-src, e.g. 'self' for an external file.

    Only the sha256 entries are ours to regenerate. Anything else the page
    declares is a deliberate choice and must survive a rewrite — dropping
    'self' would stop an external script loading, with the same silent blank
    page this tool exists to prevent."""
    return [t for t in value.split() if not t.startswith("'sha256-")]


def digest(body):
    """The hash CSP expects: sha256 of the element's exact text content."""
    return base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()


def main():
    check = "--check" in sys.argv
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir)
    stale, fixed = [], []

    for path in sorted(glob.glob(os.path.join(root, "*.html"))):
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as handle:
            page = handle.read()

        csp = CSP_RE.search(page)
        if not csp:
            continue

        stamped = stamp_assets(root, page)
        if stamped != page:
            if check:
                stale.append(name)
                print("STALE %s: shared asset ?v= stamp is out of date" % name)
                continue
            page = stamped
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(page)
            fixed.append(name + " (asset stamps)")
            print("stamp %s -> assets re-versioned" % name)

        scripts = SCRIPT_RE.findall(page)
        if not scripts:
            sys.exit("%s: pins a script hash but has no inline <script>." % name)

        # Order matters only for readability; CSP treats the list as a set.
        have = csp.group(2).strip()
        hashes = ["'sha256-%s'" % digest(body) for body in scripts]
        want = " ".join(keywords(have) + hashes)
        if want == have:
            print("ok    %s (%d script%s)"
                  % (name, len(scripts), "" if len(scripts) == 1 else "s"))
            continue

        if check:
            stale.append(name)
            print("STALE %s\n        declared %s\n        actual   %s"
                  % (name, have, want))
        else:
            patched = page[:csp.start()] + csp.group(1) + want + page[csp.end():]
            again = CSP_RE.search(patched)
            if not again or again.group(2).strip() != want:
                sys.exit("%s: rewrite produced a malformed CSP; file left alone."
                         % name)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(patched)
            fixed.append(name)
            print("fixed %s -> %s" % (name, want))

    if stale:
        sys.exit("\n%d page(s) would render blank. Run scripts/csp-hash.py to fix."
                 % len(stale))
    if fixed:
        print("\nUpdated %d page(s). Commit the meta tag alongside the script change."
              % len(fixed))


if __name__ == "__main__":
    main()
