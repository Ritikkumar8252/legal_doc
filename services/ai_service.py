import os

from dotenv import load_dotenv
from openai import OpenAI

from prompts.final_prompt import build_prompt

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def analyze_contract(contract_text):
    if not os.getenv("OPENAI_API_KEY"):
        raise ValueError('OPENAI_API_KEY is not configured')

    prompt = build_prompt(contract_text)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    )

    return response.choices[0].message.content
