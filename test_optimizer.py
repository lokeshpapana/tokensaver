import sys
sys.path.insert(0, '.')
from converter.code_optimizer import optimize_code, detect_code_style, get_compression_estimate

# Sample Python code with 4-space indentation
python_code = """
class DataProcessor:
    def __init__(self, config):
        self.config = config
        self.results = []
        self.logger = logging.getLogger(__name__)

    def process(self, data):
        for item in data:
            try:
                result = self.transform(item)
                if result is not None:
                    self.results.append(result)
            except Exception as e:
                self.logger.error(f"Error processing item: {e}")
                continue
        return self.results

    def transform(self, item):
        if not item:
            return None

        value = item.get("value", 0)
        multiplier = self.config.get("multiplier", 1)

        return {
            "original": value,
            "transformed": value * multiplier,
            "timestamp": datetime.now().isoformat()
        }

def main():
    config = {"multiplier": 2}
    processor = DataProcessor(config)
    data = [{"value": i} for i in range(100)]
    results = processor.process(data)
    print(f"Processed {len(results)} items")

if __name__ == "__main__":
    main()
"""

# Sample JS/Java code with braces
js_code = """
class DataProcessor {
    constructor(config) {
        this.config = config;
        this.results = [];
        this.logger = console;
    }

    process(data) {
        for (const item of data) {
            try {
                const result = this.transform(item);
                if (result !== null) {
                    this.results.push(result);
                }
            } catch (e) {
                this.logger.error(`Error processing item: ${e}`);
                continue;
            }
        }
        return this.results;
    }

    transform(item) {
        if (!item) {
            return null;
        }

        const value = item.value || 0;
        const multiplier = this.config.multiplier || 1;

        return {
            original: value,
            transformed: value * multiplier,
            timestamp: new Date().toISOString()
        };
    }
}

function main() {
    const config = { multiplier: 2 };
    const processor = new DataProcessor(config);
    const data = Array.from({ length: 100 }, (_, i) => ({ value: i }));
    const results = processor.process(data);
    console.log(`Processed ${results.length} items`);
}

main();
"""

print("=" * 60)
print("PYTHON CODE OPTIMIZATION")
print("=" * 60)
style = detect_code_style(python_code, ".py")
print(f"Detected style: {style}")
optimized = optimize_code(python_code, ".py")
estimate = get_compression_estimate(python_code, optimized)
print(f"Original: {estimate['original_lines']} lines, {estimate['original_chars']} chars")
print(f"Optimized: {estimate['optimized_lines']} lines, {estimate['optimized_chars']} chars")
print(f"Reduction: {estimate['reduction_percent']}%")
print(f"\nOptimized code:\n{optimized[:500]}...")

print("\n" + "=" * 60)
print("JAVASCRIPT CODE OPTIMIZATION")
print("=" * 60)
style = detect_code_style(js_code, ".js")
print(f"Detected style: {style}")
optimized = optimize_code(js_code, ".js")
estimate = get_compression_estimate(js_code, optimized)
print(f"Original: {estimate['original_lines']} lines, {estimate['original_chars']} chars")
print(f"Optimized: {estimate['optimized_lines']} lines, {estimate['optimized_chars']} chars")
print(f"Reduction: {estimate['reduction_percent']}%")
print(f"\nOptimized code:\n{optimized[:500]}...")
