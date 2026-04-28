def build_prompt(contract_text):
    return f'''Analyze this freelance contract.

Focus on:
1. Payment
2. Work scope
3. Ownership
4. Deadlines
5. Contract ending terms

Explain simply.
Find risks.
Give suggestions.
Give final advice.

Contract:
{contract_text}
'''
