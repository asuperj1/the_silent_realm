# -*- coding: utf-8 -*-
# 一次性脚本：提取 docx 文档纯文本（供阅读/生成方案）
import zipfile
from xml.etree import ElementTree as ET

NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W = '{' + NS + '}'

def extract(path, out):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    lines = []
    for p in body.iter(W + 'p'):
        texts = [t.text or '' for t in p.iter(W + 't')]
        line = ''.join(texts)
        lines.append(line)
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    return len(lines)

if __name__ == '__main__':
    n = extract(r'e:\coc-rpg-game\docs\全局系统开发文档1.0.docx',
                r'e:\coc-rpg-game\docs\全局系统开发文档1.0.extracted.txt')
    print('extracted lines:', n)
