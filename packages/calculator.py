#!/usr/bin/env python
"""
An advanced calculator module with comprehensive operations.
Calculator module for mathematical operations.
"""

import math

class Calculator:
    def __init__(self):
        self.result = 0
        self.history = []
    
    def _record(self, operation, result):
        """Record operation in history."""
        self.history.append(f"{operation} = {result}")
        return result
    
    def add(self, a, b):
        """Add two numbers together."""
        result = a + b
        return self._record(f"{a} + {b}", result)
    
    def subtract(self, a, b):
        """Subtract second number from first."""
        result = a - b
        return self._record(f"{a} - {b}", result)
    
    def multiply(self, a, b):
        """Multiply two numbers together."""
        result = a * b
        return self._record(f"{a} * {b}", result)
    
    def divide(self, a, b):
        """Divide a by b."""
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b
    
    def power(self, base, exponent):
        """Raise base to the power of exponent."""
        return base ** exponent
    
    def modulo(self, a, b):
        """Return the remainder of a divided by b."""
        if b == 0:
            raise ValueError("Cannot modulo by zero")
        return a % b
    
    def square_root(self, n):
        """Calculate the square root of n."""
        if n < 0:
            raise ValueError("Cannot calculate square root of negative number")
        return math.sqrt(n)
    
    def absolute(self, n):
        """Return the absolute value of n."""
        return abs(n)
    
    def sin(self, angle_degrees):
        """Calculate sine of angle in degrees."""
        radians = math.radians(angle_degrees)
        return math.sin(radians)
    
    def cos(self, angle_degrees):
        """Calculate cosine of angle in degrees."""
        radians = math.radians(angle_degrees)
        return math.cos(radians)
    
    def factorial(self, n):
        """Calculate factorial of n."""
        if n < 0:
            raise ValueError("Factorial not defined for negative numbers")
        return math.factorial(int(n))
    
    def get_history(self):
        """Return calculation history."""
        return self.history
    
    def clear_history(self):
        """Clear calculation history."""
        self.history = []

def main():
    calc = Calculator()
    
    print("=" * 50)
    print("🧮 ADVANCED CALCULATOR DEMO 🧮".center(50))
    print("=" * 50)
    
    # Basic operations
    print("\n📊 Basic Operations:")
    print(f"  Addition:       5 + 3 = {calc.add(5, 3)}")
    print(f"  Subtraction:   10 - 4 = {calc.subtract(10, 4)}")
    print(f"  Multiplication: 6 * 7 = {calc.multiply(6, 7)}")
    print(f"  Division:      20 / 4 = {calc.divide(20, 4)}")
    
    # Advanced operations
    print("\n🚀 Advanced Operations:")
    print(f"  Power:         2 ^ 8 = {calc.power(2, 8)}")
    print(f"  Modulo:       17 % 5 = {calc.modulo(17, 5)}")
    print(f"  Square Root:   √144 = {calc.square_root(144)}")
    print(f"  Absolute:     |-42| = {calc.absolute(-42)}")
    
    # Trigonometric and special functions
    print("\n📐 Trigonometry & Special:")
    print(f"  Sin(30°):           = {calc.sin(30):.4f}")
    print(f"  Cos(60°):           = {calc.cos(60):.4f}")
    print(f"  Factorial(5):   5! = {calc.factorial(5)}")
    
    # Show history
    print("\n📜 Calculation History:")
    for i, entry in enumerate(calc.get_history(), 1):
        print(f"  {i}. {entry}")
    
    print("\n" + "=" * 50)

if __name__ == "__main__":
    main()
