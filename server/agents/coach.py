"""Retake coach: concrete capture instructions for each quality failure, in English, Hindi and Marathi.

Deterministic and authored (not generated) so the instructions are always correct and consistent; ordered by how
much each problem usually limits gradability. The graph node picks the instructions for the failing checks of each
inadequate or limited image and attaches the measured value and threshold.
"""
from __future__ import annotations

ORDER = ["NOT_FUNDUS", "TOO_DARK", "FOCUS", "FIELD_INCOMPLETE", "GLARE", "UNEVEN", "DISC_NOT_VISIBLE",
         "MACULA_NOT_VISIBLE", "VESSELS_UNCLEAR", "MODEL_INADEQUATE", "MODEL_LIMITED"]

TIPS: dict[str, dict[str, str]] = {
    "NOT_FUNDUS": {
        "en": "This does not look like a retinal photo. Check that the camera is in fundus mode and the patient's eye fills the circle.",
        "hi": "यह रेटिना की फोटो नहीं लगती। जाँचें कि कैमरा फंडस मोड में है और मरीज़ की आँख घेरे में पूरी दिख रही है।",
        "mr": "हा रेटिनाचा फोटो वाटत नाही. कॅमेरा फंडस मोडमध्ये आहे आणि रुग्णाचा डोळा वर्तुळात पूर्ण दिसतो याची खात्री करा.",
    },
    "TOO_DARK": {
        "en": "Too dark. Let the pupil dilate (dim the room, wait 2–3 minutes or use drops if your protocol allows), then raise the flash or exposure one step.",
        "hi": "फोटो बहुत अंधेरी है। पुतली को फैलने दें (कमरे की रोशनी कम करें, 2–3 मिनट रुकें या प्रोटोकॉल अनुमति दे तो ड्रॉप्स डालें), फिर फ़्लैश या एक्सपोज़र एक स्तर बढ़ाएँ।",
        "mr": "फोटो खूप गडद आहे. बाहुली मोठी होऊ द्या (खोलीतला प्रकाश कमी करा, 2–3 मिनिटे थांबा किंवा प्रोटोकॉलनुसार ड्रॉप्स वापरा), मग फ्लॅश किंवा एक्सपोजर एक पायरी वाढवा.",
    },
    "FOCUS": {
        "en": "Blurred. Ask the patient to keep still and look at the fixation light, adjust the focus until the small vessels look sharp, then capture.",
        "hi": "फोटो धुंधली है। मरीज़ से स्थिर रहने और फ़िक्सेशन लाइट को देखने को कहें, छोटी नसें साफ़ दिखने तक फोकस ठीक करें, फिर फोटो लें।",
        "mr": "फोटो धूसर आहे. रुग्णाला स्थिर राहून फिक्सेशन लाइटकडे पाहायला सांगा, लहान रक्तवाहिन्या स्पष्ट दिसेपर्यंत फोकस करा, मग फोटो घ्या.",
    },
    "FIELD_INCOMPLETE": {
        "en": "Part of the retina is cut off. Centre the camera on the pupil and move slightly closer until the whole circle of retina is lit.",
        "hi": "रेटिना का हिस्सा कट गया है। कैमरा पुतली के बीच में रखें और थोड़ा पास लाएँ ताकि रेटिना का पूरा घेरा रोशन दिखे।",
        "mr": "रेटिनाचा काही भाग कापला गेला आहे. कॅमेरा बाहुलीच्या मध्यभागी ठेवा आणि रेटिनाचे पूर्ण वर्तुळ उजळेपर्यंत थोडा जवळ आणा.",
    },
    "GLARE": {
        "en": "Bright glare. Move the camera slightly back or sideways to avoid reflections from the cornea, and ask the patient to blink before the shot.",
        "hi": "तेज़ चमक है। कॉर्निया की चमक से बचने के लिए कैमरा थोड़ा पीछे या बगल में करें, और फोटो से पहले मरीज़ को पलक झपकाने को कहें।",
        "mr": "जास्त चमक आहे. कॉर्नियाचे परावर्तन टाळण्यासाठी कॅमेरा थोडा मागे किंवा बाजूला करा आणि फोटोपूर्वी रुग्णाला डोळे मिचकावायला सांगा.",
    },
    "UNEVEN": {
        "en": "Light is uneven across the image. Re-centre the camera on the pupil; a small or off-centre pupil often causes dark edges.",
        "hi": "फोटो में रोशनी असमान है। कैमरा फिर से पुतली के बीच में रखें; छोटी या तिरछी पुतली से किनारे अंधेरे आते हैं।",
        "mr": "फोटोमध्ये प्रकाश असमान आहे. कॅमेरा पुन्हा बाहुलीच्या मध्यभागी ठेवा; लहान किंवा तिरकी बाहुली असल्यास कडा गडद येतात.",
    },
    "DISC_NOT_VISIBLE": {
        "en": "The optic disc is not clearly visible. For a macula-centred view, ask the patient to look at the fixation light so the disc sits near the nasal edge.",
        "hi": "ऑप्टिक डिस्क साफ़ नहीं दिख रही। मैक्युला-केंद्रित फोटो के लिए मरीज़ को फ़िक्सेशन लाइट देखने को कहें ताकि डिस्क नाक की ओर किनारे पर दिखे।",
        "mr": "ऑप्टिक डिस्क स्पष्ट दिसत नाही. मॅक्युला-केंद्रित फोटोसाठी रुग्णाला फिक्सेशन लाइटकडे पाहायला सांगा म्हणजे डिस्क नाकाच्या बाजूच्या कडेला दिसेल.",
    },
    "MACULA_NOT_VISIBLE": {
        "en": "The macula (centre of vision) is not clearly visible. Re-aim so the fixation light is straight ahead and the dark central area is in the middle.",
        "hi": "मैक्युला (दृष्टि का केंद्र) साफ़ नहीं दिख रहा। ऐसे निशाना लें कि फ़िक्सेशन लाइट सीधे सामने हो और बीच का गहरा हिस्सा केंद्र में हो।",
        "mr": "मॅक्युला (दृष्टीचे केंद्र) स्पष्ट दिसत नाही. फिक्सेशन लाइट सरळ समोर आणि मधला गडद भाग केंद्रात येईल असे पुन्हा लक्ष्य करा.",
    },
    "VESSELS_UNCLEAR": {
        "en": "Blood vessels are faint. Clean the lens, check focus on the vessels, and make sure the pupil is wide enough.",
        "hi": "रक्त नलिकाएँ हल्की दिख रही हैं। लेंस साफ़ करें, नसों पर फोकस जाँचें, और पुतली पर्याप्त फैली हो यह देखें।",
        "mr": "रक्तवाहिन्या फिकट दिसत आहेत. लेन्स स्वच्छ करा, रक्तवाहिन्यांवर फोकस तपासा आणि बाहुली पुरेशी मोठी आहे याची खात्री करा.",
    },
    "MODEL_INADEQUATE": {
        "en": "The quality model judges this photo not gradable. Retake, checking focus, lighting and centring together.",
        "hi": "क्वालिटी मॉडल के अनुसार यह फोटो ग्रेड करने लायक नहीं है। फोकस, रोशनी और केंद्रण तीनों जाँचकर दोबारा फोटो लें।",
        "mr": "गुणवत्ता मॉडेलनुसार हा फोटो ग्रेड करण्याजोगा नाही. फोकस, प्रकाश आणि केंद्रण एकत्र तपासून पुन्हा फोटो घ्या.",
    },
    "MODEL_LIMITED": {
        "en": "Usable but limited. If time allows, take one more photo of this eye; the clinician will review the best one.",
        "hi": "फोटो चल सकती है पर सीमित है। समय हो तो इस आँख की एक और फोटो लें; डॉक्टर सबसे अच्छी फोटो देखेंगे।",
        "mr": "फोटो वापरता येईल पण मर्यादित आहे. वेळ असल्यास या डोळ्याचा आणखी एक फोटो घ्या; डॉक्टर सर्वोत्तम फोटो पाहतील.",
    },
}


def coach(quality: dict) -> list[dict]:
    """Instructions for one image's quality result, most important first. Empty if the image is adequate."""
    reasons = quality.get("reasons") or []
    checks = {c["code"]: c for c in quality.get("checks") or []}
    out = []
    for code in sorted(set(reasons), key=lambda c: ORDER.index(c) if c in ORDER else 99):
        t = TIPS.get(code)
        if not t:
            continue
        c = checks.get(code, {})
        out.append({"code": code, "label": c.get("label", code), "value": c.get("value"), "threshold": c.get("threshold"),
                    "hard": bool(c.get("hard")), **t})
    return out
