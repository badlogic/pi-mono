"""
Python function to fetch data from API with error handling and retries
"""

import requests
import json
from typing import Dict, Any, Optional
import time


def fetch_api_data(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
    max_retries: int = 3,
    retry_delay: float = 1.0
) -> Dict[str, Any]:
    """
    Fetch data from API with comprehensive error handling and retries.
    
    Args:
        url: API endpoint URL
        method: HTTP method (GET, POST, PUT, DELETE)
        headers: Optional headers dict
        params: Optional query parameters
        data: Optional form data
        json_data: Optional JSON data for POST/PUT requests
        timeout: Request timeout in seconds
        max_retries: Maximum number of retry attempts
        retry_delay: Delay between retries in seconds
    
    Returns:
        Dict containing response data and metadata
        {
            'success': bool,
            'data': Any,
            'status_code': int,
            'headers': Dict,
            'error': str (if failed)
        }
    """
    
    # Default headers
    default_headers = {
        'User-Agent': 'Python-API-Client/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
    
    # Merge with custom headers
    if headers:
        default_headers.update(headers)
    
    # Prepare request arguments
    request_args = {
        'timeout': timeout,
        'headers': default_headers
    }
    
    if params:
        request_args['params'] = params
    if data:
        request_args['data'] = data
    if json_data:
        request_args['json'] = json_data
    
    # Retry logic
    for attempt in range(max_retries):
        try:
            # Make the request
            response = requests.request(method.upper(), url, **request_args)
            
            # Check if request was successful
            response.raise_for_status()
            
            # Try to parse JSON response
            try:
                response_data = response.json()
            except json.JSONDecodeError:
                # If JSON parsing fails, return text content
                response_data = response.text
            
            return {
                'success': True,
                'data': response_data,
                'status_code': response.status_code,
                'headers': dict(response.headers)
            }
            
        except requests.exceptions.Timeout:
            error_msg = f"Request timed out after {timeout} seconds"
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
                continue
                
        except requests.exceptions.ConnectionError:
            error_msg = "Failed to connect to the API server"
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
                continue
                
        except requests.exceptions.HTTPError as e:
            error_msg = f"HTTP error {response.status_code}: {response.text}"
            if attempt < max_retries - 1 and response.status_code >= 500:
                # Retry on server errors (5xx)
                time.sleep(retry_delay)
                continue
                
        except requests.exceptions.RequestException as e:
            error_msg = f"Request failed: {str(e)}"
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
                continue
                
        except Exception as e:
            error_msg = f"Unexpected error: {str(e)}"
            break
    
    # If we get here, all retries failed
    return {
        'success': False,
        'error': error_msg,
        'status_code': getattr(response, 'status_code', None),
        'data': None
    }


# Convenience functions for common HTTP methods

def get_api_data(url: str, **kwargs) -> Dict[str, Any]:
    """Convenience function for GET requests"""
    return fetch_api_data(url, method="GET", **kwargs)


def post_api_data(url: str, json_data: Dict[str, Any], **kwargs) -> Dict[str, Any]:
    """Convenience function for POST requests"""
    return fetch_api_data(url, method="POST", json_data=json_data, **kwargs)


def put_api_data(url: str, json_data: Dict[str, Any], **kwargs) -> Dict[str, Any]:
    """Convenience function for PUT requests"""
    return fetch_api_data(url, method="PUT", json_data=json_data, **kwargs)


def delete_api_data(url: str, **kwargs) -> Dict[str, Any]:
    """Convenience function for DELETE requests"""
    return fetch_api_data(url, method="DELETE", **kwargs)


# Example usage and testing
if __name__ == "__main__":
    # Test with JSONPlaceholder API
    print("Testing API fetcher...")
    
    # GET request example
    result = get_api_data("https://jsonplaceholder.typicode.com/posts/1")
    if result['success']:
        print(f"GET Success: {result['data']['title']}")
    else:
        print(f"GET Failed: {result['error']}")
    
    # POST request example
    post_data = {
        "title": "Test Post",
        "body": "This is a test post",
        "userId": 1
    }
    result = post_api_data("https://jsonplaceholder.typicode.com/posts", post_data)
    if result['success']:
        print(f"POST Success: Created post ID {result['data']['id']}")
    else:
        print(f"POST Failed: {result['error']}")
    
    # Test with error handling
    result = get_api_data("https://httpbin.org/status/404")
    print(f"404 Test: Success={result['success']}, Error={result.get('error', 'None')}")
    
    print("API fetcher tests completed!")