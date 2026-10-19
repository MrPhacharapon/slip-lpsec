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
month = data.get("month", "กันยายน")
year = str(data.get("year", "2569"))
reverse_period_header = bool(data.get("reversePeriodHeader", False))
assert month in ("มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                 "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม")
assert len(year) == 4 and year.startswith("25") and year.isdigit()
assert layout in ("A", "B")
assert 1 <= len(people) <= 100  # synthetic workload ceiling for isolated E2E
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

def draw_segments(y, parts):
    x = 25
    for font, segment in parts:
        pdf.setFont(font, 14)
        pdf.drawString(x, y, segment)
        x += pdfmetrics.stringWidth(segment, font, 14) + 1

def draw_slip(person, slot, position):
    top_offset = 396 * slot
    if reverse_period_header:
        # Emulate real PDFs: month/year operator precedes the label operator,
        # even though the page visually reads label followed by month/year.
        period_text = person.get("month", month) + " ปี พ.ศ. "
        pdf.setFont("FixtureThai", 14)
        pdf.drawString(535, 770-top_offset, period_text)
        # The actual legacy PDF has reliable 4-digit text. Use Helvetica
        # to encode digits just like the already-proven synthetic generator.
        pdf.setFont("Helvetica", 14)
        pdf.drawString(535 + pdfmetrics.stringWidth(period_text, "FixtureThai", 14) + 1,
                       770-top_offset, str(person.get("year", year)))
        pdf.setFont("FixtureThai", 14)
        pdf.drawString(270, 771.5-top_offset,
                       "ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน ")
    else:
        draw_segments(770-top_offset, [
            ("FixtureThai",
             "ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน " +
             person.get("month", month) + " ปี พ.ศ. "),
            ("Helvetica", str(person.get("year", year)))
        ])
    draw_segments(742-top_offset, [
        ("FixtureThai", "ชื่อ -นามสกุล " + person["name"])
    ])
    draw_segments(714-top_offset, [
        ("FixtureThai", "รายการรายรับ เลขตำแหน่ง "),
        ("Helvetica", position),
        ("FixtureThai", " โอนเงินเข้า ธนาคารกรุงไทย จำกัด(มหาชน) เลขที่บัญชี "),
        ("Helvetica", person["account"])
    ])
    draw_segments(665-top_offset, [
        ("FixtureThai", "เงินเดือนและรายการรายรับ "),
        ("Helvetica", "99999.99")
    ])

for page_index, group in enumerate(groups):
    for slot, person in enumerate(group):
        position = ("9999999" if data.get("wrongPosition")
                    and page_index == 0 and slot == 0 else person["position"])
        draw_slip(person, slot, position)
    pdf.showPage()
pdf.save()
sys.stdout.buffer.write(output.getvalue())
