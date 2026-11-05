"""Build files/Jindou_Jia_CV.pdf from the deployed CV page.

Prints https://jiajindou.com/cv.html with headless Edge (or Chrome) using the
page's own print styles, then adds page numbers and document info with PyMuPDF.
The visit recorder and analytics are stripped first, so a build is not counted
as a visit. Rerun this after the CV's content has changed and been deployed
(publications, awards, education...), then commit the PDF.

Usage:  python tools/build_cv_pdf.py [--css compiled.css] [--out path.pdf]
        --css swaps in a locally compiled stylesheet, to try print styles
        before deploying them.
"""
import argparse
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import pymupdf

SITE = "https://jiajindou.com/"
REPO = Path(__file__).resolve().parent.parent
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
]


def find_browser():
    for b in BROWSERS:
        if os.path.exists(b) or shutil.which(b):
            return b
    raise SystemExit("No Edge or Chrome found; add its path to BROWSERS.")


def page_html(css_file):
    req = urllib.request.Request(SITE + "cv.html", headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    html, recorder = re.subn(r"<script>\s*window\.VISITOR_WORKER_URL[\s\S]*?</script>", "", html)
    if not recorder:
        raise SystemExit("Visit recorder not found on the page; refusing to count a visit.")
    html = re.sub(r"<script>\s*// GoatCounter's[\s\S]*?</script>", "", html)
    html = html.replace("<head>", f'<head>\n<base href="{SITE}">', 1)
    if css_file:
        css = Path(css_file).read_text(encoding="utf-8")
        html = re.sub(r'<link href="\./css/cv\.css[^"]*" rel="stylesheet">', lambda m: f"<style>{css}</style>", html)
    return html


def print_pdf(html, pdf_path):
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "cv.html"
        page.write_text(html, encoding="utf-8")
        # On Windows the browser's launcher can exit before printing finishes;
        # capturing its output waits for the real process, as does the polling.
        subprocess.run([
            find_browser(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
            f"--user-data-dir={Path(tmp) / 'profile'}", "--virtual-time-budget=10000",
            f"--print-to-pdf={pdf_path}", page.as_uri(),
        ], check=True, timeout=120, capture_output=True)
        last, deadline = -1, time.time() + 60
        while time.time() < deadline:
            size = Path(pdf_path).stat().st_size if Path(pdf_path).exists() else 0
            if size and size == last:
                return
            last = size
            time.sleep(1)
        raise SystemExit("The browser did not produce a PDF.")


def finish(raw_path, out_path):
    doc = pymupdf.open(raw_path)
    pages = len(doc)
    for i, page in enumerate(doc, 1):
        label = f"Jindou Jia  ·  CV  ·  {i} / {pages}"
        size = 7.5
        width = pymupdf.get_text_length(label, fontname="helv", fontsize=size)
        page.insert_text(((page.rect.width - width) / 2, page.rect.height - 24), label,
                         fontname="helv", fontsize=size, color=(0.45, 0.5, 0.56))
    doc.set_metadata({"title": "Jindou Jia - Curriculum Vitae", "author": "Jindou Jia",
                      "subject": "Curriculum Vitae", "keywords": "robot learning, world models, generative policies",
                      "creator": "jiajindou.com", "producer": ""})
    doc.save(out_path, garbage=4, deflate=True)
    doc.close()
    return pages


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--css", help="locally compiled cv.css to use instead of the deployed one")
    ap.add_argument("--out", default=str(REPO / "files" / "Jindou_Jia_CV.pdf"))
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.pdf"
        print_pdf(page_html(args.css), raw)
        pages = finish(raw, args.out)
    print(f"{args.out}: {pages} pages, {os.path.getsize(args.out) // 1024} KB")


if __name__ == "__main__":
    main()
