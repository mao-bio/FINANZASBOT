import google.generativeai as genai
import os
import json
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv('GOOGLE_API_KEY'))

models = [m.name for m in genai.list_models() if "generateContent" in m.supported_generation_methods]
with open("models.json", "w") as f:
    json.dump(models, f)
