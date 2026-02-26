#!/usr/bin/env python3
"""
check-links.py - Automated link checker for markdown documentation

This script scans all markdown files and validates internal cross-references,
relative paths, and anchor links. It does NOT check external URLs.

Usage:
    python3 scripts/check-links.py [--json] [--verbose]

Options:
    --json      Output results in JSON format
    --verbose   Show detailed progress information

Exit codes:
    0 - All links valid or fewer than 10 broken links
    1 - 10 or more broken links found
    2 - Script error
"""

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple
from urllib.parse import unquote

# Exclusion patterns
EXCLUDE_PATTERNS = [
    ".terraform",
    "node_modules",
    ".dev/ai/handoffs",
    ".dev/ai/proposals",
    "tests/",
    "profiles/nats",
]

# Placeholder links that appear in templates and should not fail scans.
IGNORED_LINK_EXACT = {
    "URL",
    "./NNNN-title.md",
}


class LinkChecker:
    def __init__(self, repo_root: Path, verbose: bool = False):
        self.repo_root = repo_root
        self.verbose = verbose
        self.broken_file_links: List[Tuple[str, str]] = []
        self.broken_anchor_links: List[Tuple[str, str, str]] = []
        self.total_files = 0
        self.total_links = 0

    def log_verbose(self, message: str):
        if self.verbose:
            print(message, file=sys.stderr)

    def should_exclude(self, path: Path) -> bool:
        """Check if path matches any exclusion pattern"""
        path_str = str(path.relative_to(self.repo_root))
        return any(pattern in path_str for pattern in EXCLUDE_PATTERNS)

    def find_markdown_files(self) -> List[Path]:
        """Find all markdown files, excluding specific patterns"""
        files = []
        for md_file in self.repo_root.rglob("*.md"):
            if not self.should_exclude(md_file):
                files.append(md_file)
        return sorted(files)

    def extract_links(self, file_path: Path) -> Set[str]:
        """Extract all links from a markdown file"""
        links = set()
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            # Ignore links inside HTML comments (template TODO sections, examples).
            content = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL)

            # Standard markdown links: [text](url)
            for match in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', content):
                links.add(match.group(2))

            # HTML href links: href="url"
            for match in re.finditer(r'href="([^"]+)"', content):
                links.add(match.group(1))

            # Angle bracket links: <url>
            for match in re.finditer(r'<(https?://[^>]+)>', content):
                links.add(match.group(1))

        except Exception as e:
            self.log_verbose(f"Error reading {file_path}: {e}")

        return links

    def normalize_heading_to_id(self, heading: str) -> str:
        """Convert a heading to GitHub-style anchor ID"""
        # Approximate GitHub slug rules:
        # - lowercase
        # - remove punctuation/symbols
        # - preserve repeated separators
        # - normalize unicode
        normalized = unicodedata.normalize("NFKD", heading)
        heading_id = normalized.lower().strip()
        heading_id = re.sub(r"<[^>]+>", "", heading_id)
        heading_id = re.sub(r"[^\w\- ]", "", heading_id)
        heading_id = re.sub(r"\s", "-", heading_id)
        heading_id = heading_id.strip("-")
        return heading_id

    def get_headings(self, file_path: Path) -> Set[str]:
        """Extract all heading IDs from a markdown file"""
        headings = set()
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            content = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL)
            for match in re.finditer(r'^#{1,6}\s+(.+)$', content, re.MULTILINE):
                heading_text = match.group(1).strip()
                heading_text = re.sub(r"\s+#+\s*$", "", heading_text)
                heading_id = self.normalize_heading_to_id(heading_text)
                headings.add(heading_id)
        except Exception as e:
            self.log_verbose(f"Error reading headings from {file_path}: {e}")

        return headings

    def resolve_path(self, source_file: Path, link: str) -> Path | None:
        """Resolve a relative or absolute link to an absolute path"""
        # Remove query strings and fragments for file checking
        file_part = link.split('#')[0].split('?')[0]

        if not file_part:
            return source_file.resolve()  # Anchor-only link to same file

        # Handle absolute paths from repo root
        if file_part.startswith('/'):
            target = self.repo_root / file_part.lstrip('/')
        else:
            # Relative path from source file's real directory (resolve symlinks first)
            target = source_file.resolve().parent / file_part

        # Normalize path
        try:
            return target.resolve()
        except Exception:
            return None

    def should_ignore_link(self, link: str) -> bool:
        """Skip placeholder/template links."""
        return link.strip() in IGNORED_LINK_EXACT

    def check_link(self, source_file: Path, link: str) -> bool:
        """Check if a link is valid"""
        if self.should_ignore_link(link):
            return True

        # Skip external URLs (per requirements)
        if re.match(r'^(https?|mailto|ftp|data|javascript):', link):
            return True

        # Extract file and anchor parts
        if '#' in link:
            file_part, anchor_part = link.split('#', 1)
        else:
            file_part, anchor_part = link, None

        # Resolve target file
        target_file = self.resolve_path(source_file, file_part)

        if not target_file:
            self.broken_file_links.append((str(source_file.relative_to(self.repo_root)), link))
            return False

        # Check file exists (unless it's an anchor-only link to same file)
        if file_part and not target_file.exists():
            self.broken_file_links.append((str(source_file.relative_to(self.repo_root)), link))
            return False

        # Check anchor if present
        if anchor_part:
            headings = self.get_headings(target_file)
            anchor_id = self.normalize_heading_to_id(unquote(anchor_part))

            if anchor_id not in headings:
                self.broken_anchor_links.append((
                    str(source_file.relative_to(self.repo_root)),
                    link,
                    str(target_file.relative_to(self.repo_root)) if target_file != source_file else "same file"
                ))
                return False

        return True

    def scan(self) -> Dict:
        """Scan all markdown files and check links"""
        files = self.find_markdown_files()
        self.total_files = len(files)

        self.log_verbose(f"Scanning {self.total_files} markdown files...")

        for file_path in files:
            self.log_verbose(f"Checking: {file_path.relative_to(self.repo_root)}")

            links = self.extract_links(file_path)
            for link in links:
                self.total_links += 1
                self.check_link(file_path, link)

        # Build report
        broken_count = len(self.broken_file_links) + len(self.broken_anchor_links)

        return {
            "scan_date": datetime.utcnow().isoformat() + "Z",
            "repository_root": str(self.repo_root),
            "broken_links": {
                "internal_cross_references": [
                    {"file": f, "link": l} for f, l in self.broken_file_links
                ],
                "anchor_links": [
                    {"file": f, "link": l, "target": t} for f, l, t in self.broken_anchor_links
                ],
            },
            "statistics": {
                "total_files_scanned": self.total_files,
                "total_links_checked": self.total_links,
                "broken_links_count": broken_count,
            }
        }


def main():
    parser = argparse.ArgumentParser(description="Check markdown links")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")
    parser.add_argument("--verbose", action="store_true", help="Show detailed progress")
    args = parser.parse_args()

    # Determine repo root (script is in scripts/ directory)
    script_path = Path(__file__).resolve()
    repo_root = script_path.parent.parent

    # Run checker
    checker = LinkChecker(repo_root, verbose=args.verbose)
    report = checker.scan()

    # Output results
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        stats = report["statistics"]
        print("\nLink Check Report")
        print("=================")
        print(f"Scanned: {stats['total_files_scanned']} files")
        print(f"Checked: {stats['total_links_checked']} links")
        print(f"Broken:  {stats['broken_links_count']} links")
        print()

        if stats['broken_links_count'] > 0:
            if report["broken_links"]["internal_cross_references"]:
                print("Broken Internal File References:")
                for item in report["broken_links"]["internal_cross_references"]:
                    print(f"  - {item['file']} -> {item['link']}")
                print()

            if report["broken_links"]["anchor_links"]:
                print("Broken Anchor Links:")
                for item in report["broken_links"]["anchor_links"]:
                    print(f"  - {item['file']} -> {item['link']} (in {item['target']})")
                print()

    # Exit code based on threshold
    if report["statistics"]["broken_links_count"] >= 10:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
