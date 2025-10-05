const simpleHtml = {
    "systemPrompt": "You are a helpful AI assistant with access to various tools.\n\nAvailable tools:\n- Calculator: Perform mathematical calculations\n- Current Time: Get the current date and time in any timezone\n- Artifacts: Create interactive HTML, SVG, Markdown, and text artifacts\n\nFeel free to use these tools when needed to provide accurate and helpful responses.",
    "model": {
        "id": "claude-sonnet-4-5-20250929",
        "name": "Claude Sonnet 4.5",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
            "text",
            "image"
        ],
        "cost": {
            "input": 3,
            "output": 15,
            "cacheRead": 0.3,
            "cacheWrite": 3.75
        },
        "contextWindow": 200000,
        "maxTokens": 64000
    },
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "simple html"
                }
            ]
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I'll create a simple HTML page for you!"
                },
                {
                    "type": "toolCall",
                    "id": "toolu_01JXaq9rMAUt1goJ5tMQXgLh",
                    "name": "artifacts",
                    "arguments": {
                        "command": "create",
                        "filename": "index.html",
                        "title": "Simple HTML Page",
                        "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Simple HTML Page</title>\n    <style>\n        body {\n            font-family: Arial, sans-serif;\n            max-width: 800px;\n            margin: 0 auto;\n            padding: 20px;\n            background-color: #f5f5f5;\n        }\n        \n        header {\n            background-color: #4CAF50;\n            color: white;\n            padding: 20px;\n            text-align: center;\n            border-radius: 8px;\n        }\n        \n        main {\n            background-color: white;\n            padding: 20px;\n            margin-top: 20px;\n            border-radius: 8px;\n            box-shadow: 0 2px 4px rgba(0,0,0,0.1);\n        }\n        \n        button {\n            background-color: #4CAF50;\n            color: white;\n            padding: 10px 20px;\n            border: none;\n            border-radius: 4px;\n            cursor: pointer;\n            font-size: 16px;\n        }\n        \n        button:hover {\n            background-color: #45a049;\n        }\n    </style>\n</head>\n<body>\n    <header>\n        <h1>Welcome to My Simple Page</h1>\n    </header>\n    \n    <main>\n        <h2>Hello!</h2>\n        <p>This is a simple HTML page with some basic styling.</p>\n        \n        <h3>Features:</h3>\n        <ul>\n            <li>Clean design</li>\n            <li>Responsive layout</li>\n            <li>Interactive button</li>\n        </ul>\n        \n        <button onclick=\"showMessage()\">Click Me!</button>\n        <p id=\"message\"></p>\n    </main>\n    \n    <script>\n        function showMessage() {\n            document.getElementById('message').textContent = '✨ Thanks for clicking!';\n        }\n    </script>\n</body>\n</html>"
                    }
                }
            ],
            "api": "anthropic-messages",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5-20250929",
            "usage": {
                "input": 2108,
                "output": 666,
                "cacheRead": 0,
                "cacheWrite": 0,
                "cost": {
                    "input": 0.006324,
                    "output": 0.00999,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "total": 0.016314000000000002
                }
            },
            "stopReason": "toolUse"
        },
        {
            "role": "toolResult",
            "toolCallId": "toolu_01JXaq9rMAUt1goJ5tMQXgLh",
            "toolName": "artifacts",
            "output": "Created file index.html\n\nExecution timed out. Partial logs:\nKeine Logs für index.html",
            "isError": false
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I've created a simple HTML page for you! It includes:\n\n- **Clean header** with a green background\n- **Main content area** with a white card-style design\n- **A list** showing some features\n- **An interactive button** that displays a message when clicked\n- **Responsive styling** that looks good on different screen sizes\n\nThe page has a light gray background and uses simple, clean styling. Try clicking the button to see it in action! \n\nWould you like me to modify anything or add more features?"
                }
            ],
            "api": "anthropic-messages",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5-20250929",
            "usage": {
                "input": 2811,
                "output": 115,
                "cacheRead": 0,
                "cacheWrite": 0,
                "cost": {
                    "input": 0.008433,
                    "output": 0.001725,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "total": 0.010158
                }
            },
            "stopReason": "stop"
        }
    ]
};