#!/usr/bin/env python3
import markdown
import sys


def convert_markdown_to_html(markdown_file: str, output_html_file: str) -> None:
    with open(markdown_file, "r", encoding="utf-8") as f:
        content = f.read()

    html_content = markdown.markdown(content, extensions=["fenced_code", "tables", "nl2br"])

    html_document = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>Release Notes</title>
  <style>
    :root {{ color-scheme: light dark; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }}
    code {{
      font-family: monospace;
      background-color: rgba(150, 150, 150, 0.12);
      padding: 2px 4px;
      border-radius: 3px;
    }}
    pre {{
      background-color: rgba(150, 150, 150, 0.12);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }}
  </style>
</head>
<body>
{html_content}
</body>
</html>
"""

    with open(output_html_file, "w", encoding="utf-8") as f:
        f.write(html_document)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert-markdown.py <markdown_file> <output_html_file>")
        sys.exit(1)

    convert_markdown_to_html(sys.argv[1], sys.argv[2])
