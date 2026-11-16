"""Genera icon-192.png e icon-512.png (sin dependencias) con el mismo diseño que icon.svg."""
import struct, zlib, sys, os

def png(size, path):
    s = size / 512
    def inside_round(x, y, x0, y0, x1, y1, r):
        if x < x0 or x > x1 or y < y0 or y > y1: return False
        cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            x, y = i / s, j / s
            col = (14, 14, 16)
            outer = inside_round(x, y, 85, 139, 427, 373, 38)
            inner = inside_round(x, y, 107, 161, 405, 351, 17)
            if outer and not inner: col = (37, 244, 238)
            # triángulo play
            if 220 <= x <= 316 and 200 <= y <= 312:
                t = (x - 220) / 96
                if abs(y - 256) <= 56 * (1 - t): col = (254, 44, 85)
            row += bytes(col)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for n in (192, 512):
    png(n, os.path.join(base, f'icon-{n}.png'))
print('ok')
