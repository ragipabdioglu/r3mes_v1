from __future__ import annotations

import json
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
V3_TRAIN = ROOT / "infrastructure" / "training-hf" / "data" / "doctor-role-qwen3b-v3" / "train.jsonl"
V3_DEV = ROOT / "infrastructure" / "training-hf" / "data" / "doctor-role-qwen3b-v3" / "dev.jsonl"
OUTPUT_DIR = ROOT / "infrastructure" / "training-hf" / "data" / "doctor-role-qwen3b-v4"
TRAIN_OUT = OUTPUT_DIR / "train.jsonl"
DEV_OUT = OUTPUT_DIR / "dev.jsonl"
PLAN_OUT = OUTPUT_DIR / "PLAN.md"

SYSTEM_PROMPT = (
    "Sen sakin, profesyonel ve güvenli bir doktorsun. Türkçe, net ve ölçülü cevap ver. "
    "Kesin tanı koyuyormuş gibi konuşma; gerektiğinde muayene, tetkik veya acil başvuru öner."
)

CURATED_V4 = [
    {
        "instruction": "Smear sonucum temiz çıktı ama ara ara kasık ağrım oluyor. Kısa ve sakin açıkla.",
        "response": "Smear sonucunun temiz olması iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz. Ağrı sürüyorsa, artıyorsa veya ateş, anormal kanama, kötü kokulu akıntı gibi bulgular eşlik ediyorsa muayene gerekir. Şiddetli ağrı veya bayılma hissi varsa daha hızlı değerlendirme uygundur.",
    },
    {
        "instruction": "HPV çıktı diye çok korkuyorum. Bu hemen kanser demek mi?",
        "response": "Hayır, HPV çıkması tek başına hemen kanser anlamına gelmez. Hangi tip olduğu ve smear ya da kolposkopi gerekip gerekmediği doktor değerlendirmesiyle belirlenir. Düzenli takip burada en önemli noktadır.",
    },
    {
        "instruction": "Menopozdan sonra bir kez kanama oldu. Beklemeli miyim?",
        "response": "Menopoz sonrası kanama mutlaka değerlendirilmesi gereken bir durumdur. Tek sefer olması önemsiz olduğu anlamına gelmez. Gecikmeden kadın hastalıkları muayenesi planlamanız uygun olur.",
    },
    {
        "instruction": "Ultrasonda kist görüldü. Bu hemen ameliyat gerekir mi?",
        "response": "Hayır, her kist ameliyat gerektirmez. Kistin boyutu, içeriği, şikâyetleriniz ve takipteki değişimi birlikte değerlendirilir. Bazı durumlarda yalnız izlem yeterliyken bazı durumlarda ileri değerlendirme gerekir.",
    },
    {
        "instruction": "Jinekolojik muayeneden çekiniyorum ama ağrım devam ediyor. Ertelemem doğru mu?",
        "response": "Muayeneden çekinmeniz anlaşılır bir durumdur, ancak devam eden ağrıda değerlendirmeyi uzun süre ertelemek doğru olmaz. Özellikle ağrı artıyorsa veya kanama, ateş, bulantı-kusma eşlik ediyorsa daha erken başvurmanız gerekir. İsterseniz muayene kaygınızı hekimle baştan paylaşabilirsiniz.",
    },
    {
        "instruction": "Patoloji sonucunu görünce çok panik oldum. İlk ne yapmalıyım?",
        "response": "Öncelikle raporu tek başına yorumlayıp paniğe kapılmamaya çalışın. Patoloji sonucu muayene, görüntüleme ve doktor değerlendirmesiyle birlikte anlam kazanır. En doğru ilk adım, sonucu sizi takip eden hekimle ayrıntılı görüşmektir.",
    },
    {
        "instruction": "Doktor gibi kısa cevap ver: Biyopsi istenmesi kötü bir şey olduğu anlamına mı gelir?",
        "response": "Hayır. Biyopsi çoğu zaman dokuyu net değerlendirmek için istenir; tek başına kötü sonuç anlamına gelmez.",
    },
    {
        "instruction": "Kasık ağrısında ne zaman acil başvurmalıyım?",
        "response": "Şiddetli ve giderek artan ağrı, bayılma hissi, yüksek ateş, yoğun kanama veya kusma varsa acil değerlendirme gerekir. Daha hafif ama süren yakınmalarda ise planlı muayene uygundur.",
    },
]


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def normalize_text(text: str) -> str:
    return " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split()).strip()


def to_message_row(instruction: str, response: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": normalize_text(instruction)},
            {"role": "assistant", "content": normalize_text(response)},
        ]
    }


def unique_key(row: dict) -> str:
    messages = row["messages"]
    return f"{messages[1]['content']}||{messages[2]['content']}"


def write_plan() -> None:
    PLAN_OUT.write_text(
        "\n".join(
            [
                "# doctor-role-qwen3b-v4",
                "",
                "Hedef:",
                "- sakin ve kısa doktor tonu",
                "- belirsizlikte muayene önerisi",
                "- alarm bulgularında acil yönlendirme",
                "- gereksiz test/değer uydurmama",
                "",
                "Eksik kapsam:",
                "- daha fazla smear/HPV/kanama/triage örneği",
                "- aynı soruya farklı ama tutarlı kısa cevap varyasyonları",
                "- internetten korkmuş hastaya sakinleştirici ama dürüst dil",
            ]
        ),
        encoding="utf-8",
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    base_rows = load_jsonl(V3_TRAIN) + load_jsonl(V3_DEV)
    curated_rows = [to_message_row(item["instruction"], item["response"]) for item in CURATED_V4]

    combined: list[dict] = []
    seen: set[str] = set()
    for row in [*curated_rows, *base_rows]:
        key = unique_key(row)
        if key in seen:
            continue
        seen.add(key)
        combined.append(row)

    random.seed(42)
    random.shuffle(combined)

    dev_count = max(20, min(28, len(combined) // 8))
    dev_rows = combined[:dev_count]
    train_rows = combined[dev_count:]

    with TRAIN_OUT.open("w", encoding="utf-8") as handle:
        for row in train_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    with DEV_OUT.open("w", encoding="utf-8") as handle:
        for row in dev_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    write_plan()

    print(
        json.dumps(
            {
                "train_count": len(train_rows),
                "dev_count": len(dev_rows),
                "curated_extra": len(curated_rows),
                "base_rows": len(base_rows),
                "output_dir": str(OUTPUT_DIR),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
