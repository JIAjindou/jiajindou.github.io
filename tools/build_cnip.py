"""Build data/cnip.bin: a compact mainland-China IP -> city table for the
visitor Worker, from ip2region's ipv4/ipv6 source files (Apache-2.0/MIT).

Layout (little-endian), all typed-array sections 4-byte aligned:
  0  "CNIP"           magic
  4  u32 version (1)
  8  u32 n4           IPv4 segments
  12 u32 n6           IPv6 segments
  16 u32 cityOff      byte offset of city JSON
  20 u32 cityLen      byte length of city JSON
  24 u32[n4] v4 start, u16[n4] v4 key, pad
     u32[n6] v6 start bits 0-31, u32[n6] v6 start bits 32-63, u16[n6] v6 key, pad
     city JSON: [[name, region, lat, lon, cityPrecise(0/1)], ...]
A segment covers [start, next start). key 0xFFFF = not mainland China.
"""
import io, ipaddress, json, re, struct, sys
from pypinyin import lazy_pinyin

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "cnip.bin"
GAP = 0xFFFF

coords = json.load(io.open(f"{SRC}/city_coords.json", encoding="utf-8"))

# Province (as ip2region spells it) -> capital, and English province name.
CAPITAL = {
    "北京市": "北京", "天津市": "天津", "上海市": "上海", "重庆市": "重庆",
    "河北省": "石家庄", "山西省": "太原", "辽宁省": "沈阳", "吉林省": "长春", "黑龙江省": "哈尔滨",
    "江苏省": "南京", "浙江省": "杭州", "安徽省": "合肥", "福建省": "福州", "江西省": "南昌",
    "山东省": "济南", "河南省": "郑州", "湖北省": "武汉", "湖南省": "长沙", "广东省": "广州",
    "海南省": "海口", "四川省": "成都", "贵州省": "贵阳", "云南省": "昆明", "陕西省": "西安",
    "甘肃省": "兰州", "青海省": "西宁", "内蒙古": "呼和浩特", "广西": "南宁", "西藏": "拉萨",
    "宁夏": "银川", "新疆": "乌鲁木齐",
}
PROV_EN = {"内蒙古": "Inner Mongolia", "西藏": "Tibet", "陕西省": "Shaanxi", "山西省": "Shanxi"}
# Well-known exonyms / pinyin pypinyin may get wrong.
CITY_EN = {"呼和浩特": "Hohhot", "乌鲁木齐": "Urumqi", "拉萨": "Lhasa", "西安": "Xi'an",
           "六安": "Lu'an", "蚌埠": "Bengbu", "长治": "Changzhi", "乐山": "Leshan",
           "丽水": "Lishui", "丽江": "Lijiang", "厦门": "Xiamen", "重庆": "Chongqing",
           "喀什地区": "Kashgar", "喀什": "Kashgar", "番禺": "Panyu", "东营": "Dongying",
           "大理": "Dali", "长沙": "Changsha", "长春": "Changchun", "济宁": "Jining",
           "莆田": "Putian", "宿迁": "Suqian", "宿州": "Suzhou", "朝阳": "Chaoyang",
           "漯河": "Luohe", "都匀": "Duyun", "吕梁": "Lüliang", "哈尔滨": "Harbin",
           "齐齐哈尔": "Qiqihar", "呼伦贝尔": "Hulunbuir", "巴彦淖尔": "Bayannur", "鄂尔多斯": "Ordos",
           "乌兰察布": "Ulanqab", "阿拉善": "Alxa", "锡林郭勒": "Xilingol", "阿勒泰": "Altay",
           "博尔塔拉": "Bortala", "巴音郭楞": "Bayingolin", "克拉玛依": "Karamay", "吐鲁番": "Turpan",
           "阿克苏": "Aksu", "和田": "Hotan", "伊犁": "Ili", "克孜勒苏": "Kizilsu", "日喀则": "Shigatse",
           "林芝": "Nyingchi", "那曲": "Nagqu", "阿里": "Ngari", "昌都": "Qamdo", "果洛": "Golog"}
# ip2region occasionally puts a city in the province field.
PROV_FIX = {"广州市": "广东省", "武汉市": "湖北省"}
# Coordinates the generic lookup gets wrong (homonyms) or lacks: (province, short name) -> (lat, lon).
COORD_FIX = {("青海省", "海南"): (36.3, 100.6), ("云南省", "金平"): (22.8, 103.2),
             ("新疆", "克孜勒苏"): (39.7, 76.2), ("贵州省", "黔西南"): (25.1, 104.9)}
# Keep the coordinates the existing (Cloudflare-geolocated) points already use,
# so new and old visits from these cities land on the same dot.
SAME_DOT = {"北京": (39.9, 116.4), "上海": (31.2, 121.5), "广州": (23.1, 113.3),
            "杭州": (30.3, 120.2), "天津": (39.1, 117.2), "南京": (32.1, 118.8)}

ETHNIC = sorted("""壮族 回族 满族 维吾尔族 苗族 彝族 土家族 藏族 蒙古族 侗族 布依族 瑶族 白族 朝鲜族 哈尼族
黎族 哈萨克族 傣族 畲族 傈僳族 东乡族 仡佬族 拉祜族 佤族 水族 纳西族 羌族 土族 仫佬族 锡伯族 柯尔克孜族
景颇族 达斡尔族 撒拉族 布朗族 毛南族 塔吉克族 普米族 阿昌族 怒族 鄂温克族 京族 基诺族 德昂族 保安族
裕固族 乌孜别克族 门巴族 鄂伦春族 独龙族 赫哲族 珞巴族 蒙古 哈萨克 柯尔克孜 维吾尔 塔吉克""".split(),
                key=len, reverse=True)

def short(name):
    s = re.sub(r"(自治州|自治县|自治旗)$", "", name)
    stripped = True
    while stripped:                       # 湘西土家族苗族 -> 湘西
        stripped = False
        for e in ETHNIC:
            if s.endswith(e) and len(s) > len(e):
                s, stripped = s[:-len(e)], True
                break
    return re.sub(r"(特别行政区|地区|林区|盟|市|县|区)$", "", s) or name

# English city names that ip2region uses for a few places.
EN_CITY_CN = {"Guang'an": "广安", "Changzhi": "长治", "Shuozhou": "朔州", "Xinyu": "新余",
              "Shahejie": "九江", "Taichung County": "台中"}
# A few names absent from the coordinate table: map to the city that contains them.
ALIAS = {"虢镇": "宝鸡", "普洱": "思茅", "北碚": "重庆", "金城": "晋城"}

def pinyin(cn):
    sy = lazy_pinyin(cn)
    out = sy[0].capitalize()
    for x in sy[1:]:
        out += ("'" if x[:1] in "aeo" else "") + x
    return out

def city_en(cn):
    s = short(cn)
    return CITY_EN.get(cn) or CITY_EN.get(s) or pinyin(s)

def prov_en(p):
    return PROV_EN.get(p) or pinyin(re.sub(r"(省|市|自治区|壮族自治区|回族自治区|维吾尔自治区)$", "", p))

# Short-name index over the coordinate table (湘西土家族苗族自治州 -> 湘西, ...).
SHORT_IDX = {}
for k, v in coords.items():
    SHORT_IDX.setdefault(short(k), []).append(v)

WIDE = {"新疆", "西藏", "内蒙古", "青海省", "黑龙江省", "四川省", "甘肃省", "云南省"}
def plausible(prov, lat, lon):
    """Reject homonyms: a city's dot must sit near its own province capital."""
    cap = CAPITAL.get(prov)
    cv = coords.get(cap) if cap else None
    if not cv: return True
    return abs(lat - cv[1]) <= (13 if prov in WIDE else 6.5) and abs(lon - cv[0]) <= (16 if prov in WIDE else 7)

def coord(cn, prov):
    s = short(cn)
    if s in SAME_DOT: return SAME_DOT[s]
    if (prov, s) in COORD_FIX: return COORD_FIX[(prov, s)]
    cands = [coords.get(k) for k in (cn, s, s + "市", ALIAS.get(s, ""))] + SHORT_IDX.get(s, []) + SHORT_IDX.get(ALIAS.get(s, ""), [])
    cands = [v for v in cands if v and plausible(prov, v[1], v[0])]
    if not cands: return None
    cap = coords.get(CAPITAL.get(prov, ""))
    if cap:  # among homonyms, the one nearest the province capital is the right one
        cands.sort(key=lambda v: (v[0] - cap[0]) ** 2 + (v[1] - cap[1]) ** 2)
    v = cands[0]
    return (round(v[1], 1), round(v[0], 1))  # json is [lng, lat]

cities, index, problems = [], {}, []
SKIP_PROV = {"", "0", "台湾省", "香港特别行政区", "澳门特别行政区"}  # Cloudflare reports these as TW/HK/MO
CAP_TO_PROV = {v: k for k, v in CAPITAL.items()}
def key_for(prov, city):
    prov = PROV_FIX.get(prov, prov)
    if prov not in CAPITAL and short(prov) in CAP_TO_PROV:   # province field holds a capital city
        prov = CAP_TO_PROV[short(prov)]
    if prov in SKIP_PROV: return GAP
    city = EN_CITY_CN.get(city, city)
    precise = city not in ("0", "")
    if not precise:
        cap = CAPITAL.get(prov)
        if not cap: problems.append(("no capital", prov)); return GAP
        city = cap
    k = (prov, city)
    if k in index: return index[k]
    c = coord(city, prov)
    if not c:
        problems.append(("no coord, using capital", prov, city))
        index[k] = key_for(prov, "0") if precise else GAP   # province-only entry (capital dot)
        return index[k]
    index[k] = len(cities)
    cities.append([city_en(city), prov_en(prov), c[0], c[1], 1 if precise else 0])
    return index[k]

def build(path, parse, width):
    segs = []  # [start_int, key]
    prev_end = -1
    for line in io.open(path, encoding="utf-8"):
        f = line.rstrip("\n").split("|")
        if len(f) != 7: continue
        s, e = parse(f[0]), parse(f[1])
        key = key_for(f[3], f[4]) if f[6] == "CN" else GAP
        if s != prev_end + 1:
            segs.append([prev_end + 1, GAP])
        if segs and segs[-1][1] == key:
            pass
        else:
            segs.append([s, key])
        prev_end = e
    return segs

v4 = build(f"{SRC}/ipv4_source.txt", lambda x: int(ipaddress.IPv4Address(x)), 32)
v6full = build(f"{SRC}/ipv6_source.txt", lambda x: int(ipaddress.IPv6Address(x)), 128)
# IPv6: keep the top 64 bits of each start (ranges are /64-aligned or coarser in practice).
v6, misaligned = [], 0
for s, k in v6full:
    hi = s >> 64
    if s & ((1 << 64) - 1): misaligned += 1
    if v6 and v6[-1][0] == hi:
        v6[-1][1] = k
    elif v6 and v6[-1][1] == k:
        continue
    else:
        v6.append([hi, k])

city_json = json.dumps(cities, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
def pad(b):
    return b + b"\0" * (-len(b) % 4)
body = bytearray()
v4s = struct.pack(f"<{len(v4)}I", *[s for s, _ in v4]); v4k = pad(struct.pack(f"<{len(v4)}H", *[k for _, k in v4]))
v6a = struct.pack(f"<{len(v6)}I", *[h & 0xFFFFFFFF for h, _ in v6])           # bits 32-63 of the address
v6b = struct.pack(f"<{len(v6)}I", *[(h >> 32) & 0xFFFFFFFF for h, _ in v6])    # bits 0-31 (most significant)
v6k = pad(struct.pack(f"<{len(v6)}H", *[k for _, k in v6]))
head_len = 24
city_off = head_len + len(v4s) + len(v4k) + len(v6a) + len(v6b) + len(v6k)
header = b"CNIP" + struct.pack("<5I", 1, len(v4), len(v6), city_off, len(city_json))
blob = header + v4s + v4k + v6b + v6a + v6k + city_json
open(OUT, "wb").write(blob)

out = sys.stdout.buffer
out.write(f"v4 segments {len(v4)} | v6 segments {len(v6)} (misaligned v6 starts {misaligned}) | cities {len(cities)}\n".encode())
out.write(f"file {len(blob)/1024:.0f} KB -> {OUT}\n".encode())
out.write(f"problems ({len(problems)}):\n".encode())
for p in sorted(set(problems))[:60]:
    out.write(("  " + " | ".join(map(str, p)) + "\n").encode("utf-8"))
io.open(OUT + ".cities.txt", "w", encoding="utf-8").write(
    "\n".join(f"{i}\t{c[0]}\t{c[1]}\t{c[2]},{c[3]}\t{'city' if c[4] else 'province-only'}" for i, c in enumerate(cities)))
