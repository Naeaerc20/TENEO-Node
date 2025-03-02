import sys
import os
import json

sys.path.append(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
from twocaptcha import TwoCaptcha

api_key = 'YOUR_2CAPTCHA_API'
solver = TwoCaptcha(api_key)

try:
    result = solver.turnstile(
        sitekey='0x4AAAAAAAkhmGkb2VS6MRU0',
        url='https://dashboard.teneo.pro/auth',
    )
except Exception as e:
    sys.stdout.write(json.dumps({"error": str(e)}))
    sys.exit(1)
else:
    sys.stdout.write(json.dumps({"code": result.get("code")}))
    sys.exit(0)
