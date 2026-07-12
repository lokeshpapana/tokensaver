import requests
import json

BASE_URL = "http://localhost:8000"

# Test health endpoint
resp = requests.get(f"{BASE_URL}/api/health")
print(f"Health: {resp.json()}")

# Create a test file
test_content = """def hello():
    print("Hello World")
    return True

class Calculator:
    def add(self, a, b):
        return a + b

    def multiply(self, a, b):
        return a * b
""" * 100

# Test single file conversion
files = {'file': ('test.py', test_content.encode(), 'text/plain')}
resp = requests.post(f"{BASE_URL}/api/convert?mode=standard", files=files)
data = resp.json()
print(f"\nConversion result:")
print(f"  File: {data['filename']}")
print(f"  Mode: {data.get('mode', 'N/A')}")
print(f"  Characters: {data['stats']['characters']}")
print(f"  Text tokens: {data['stats']['text_tokens_display']}")
print(f"  Image tokens: {data['stats']['image_tokens_display']}")
print(f"  Savings: {data['stats']['savings_percent']}%")
print(f"  Pages: {data['stats']['pages']}")
print(f"  Recommendation: {data['stats'].get('recommendation', 'N/A')}")

# Test API key generation
resp = requests.post(f"{BASE_URL}/api/keys/generate?tier=free&description=test-key")
key_data = resp.json()
print(f"\nAPI Key generated:")
print(f"  Key: {key_data['api_key'][:20]}...")
print(f"  Tier: {key_data['tier']}")

# Test with API key
headers = {'X-API-Key': key_data['api_key']}
resp = requests.get(f"{BASE_URL}/api/keys/check", headers=headers)
print(f"\nKey check: {resp.json()}")
