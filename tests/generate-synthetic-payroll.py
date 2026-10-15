#!/usr/bin/env python3
"""Synthetic-only payroll PDF generator for isolated web app browser tests.

Input: JSON on stdin {layout:"A"|"B",people:[{name,account,position}],wrongPosition:bool}
Output: PDF bytes on stdout. NO real personnel records or online calls.
"""
import io
import json
import os
import subprocess
import sys

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

data = json.load(sys.stdin)
people = data["people"]
layout = data["layout"]
assert layout in ("A", "B")
assert len(people) <= 20 and len(people) >= 1
for p in people:
    assert len(p["account"]) == 10 and p["account"].isdigit()
    assert len(p["position"]) == 7 and p["position"].isdigit()

font_path = subprocess.check_output(
    ["fc-match", "-f", "%{file}", "Noto Sans Thai"],
    text=True,
).strip()
if not os.path.isfile(font_path) or not font_path.lower().endswith(".ttf"):
    raise RuntimeError("Noto Sans Thai TTF not available for synthetic PDF")
pdfmetrics.registerFont(TTFont("FixtureThai", font_path))

output = io.BytesIO()
pdf = canvas.Canvas(output, pagesize=(1071, 792), pageCompression=1)
pdf.setTitle("SYNTHETIC TEST ONLY")
groups = ([[p] for p in people] if layout == "A"
          else [people[i:i+2] for i in range(0, len(people), 2)])

def draw_slip(person, slot, position):
    top_offset = 396 * slot
    pdf.setFont("FixtureThai", 14)
    pdf.drawString(25, 770-top_offset,
        "ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน กันยายน ปี พ.ศ. 2569")
    pdf.drawString(25, 742-top_offset, "ชื่อ -นามสกุล " + person["name"])
    pdf.drawString(25, 714-top_offset,
        "รายการรายรับ เลขตำแหน่ง " + position +
        " โอนเงินเข้า ธนาคารกรุงไทย จำกัด(มหาชน) เลขที่บัญชี " + person["account"])
    pdf.drawString(25, 665-top_offset, "เงินเดือนและรายการรายรับ 99999.99")

for page_index, group in enumerate(groups):
    for slot, person in enumerate(group):
        position = ("9999999" if data.get("wrongPosition")
                    and page_index == 0 and slot == 0 else person["position"])
        draw_slip(person, slot, position)
    pdf.showPage()
pdf.save()
sys.stdout.buffer.write(output.getvalue())
