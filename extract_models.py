import json
import sys

try:
    with open(r'C:\Users\Admin\.local\share\opencode\tool-output\tool_c46f82d30001YIyDg8bFDX60yu', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    providers_keywords = ['moonshot', 'deepseek']
    
    found_keys = []
    
    for key, val in data.items():
        # Check if key contains any of the target providers
        # Since 'moonshot' is likely the key for 'moonshot-ai', or 'moonshot' itself.
        # We also want to check if the 'id' field inside the provider data matches.
        
        match_found = False
        for p in providers_keywords:
            if p in key.lower() or (isinstance(val, dict) and p in val.get('id', '').lower()):
                match_found = True
                break
        
        if match_found:
            found_keys.append(key)
            print(f"--- Provider: {key} ---")
            
            provider_models = val.get('models', {})
            
            for model_id, model_info in provider_models.items():
                print(f"Model ID: {model_id}")
                print(f"  Name: {model_info.get('name', 'N/A')}")
                
                limit = model_info.get('limit', {})
                context_limit = limit.get('context', 'N/A')
                output_limit = limit.get('output', 'N/A')
                print(f"  Limits - Context: {context_limit}, Output: {output_limit}")
                
                cost = model_info.get('cost', {})
                input_cost = cost.get('input', 'N/A')
                output_cost = cost.get('output', 'N/A')
                print(f"  Pricing - Input: {input_cost}, Output: {output_cost}")
                
                print(f"  Tool Call: {model_info.get('tool_call', False)}")
                print("-" * 20)
            print("=" * 40)
            
    if not found_keys:
        print("No providers found matching 'moonshot' or 'deepseek'.")
        
except Exception as e:
    print(f"Error: {e}")
