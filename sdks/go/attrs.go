package obs

import "go.opentelemetry.io/otel/attribute"

// Internal helpers for converting heterogenous attribute slices into the
// strongly-typed []attribute.KeyValue the OTel resource builder requires.

type attrKV struct {
	Key   string
	Value any
}

func toKeyValues(items []any) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, len(items))
	for _, it := range items {
		if kv, ok := it.(attribute.KeyValue); ok {
			out = append(out, kv)
		}
	}
	return out
}

func toKeyValuesFromExtras(items []attrKV) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, len(items))
	for _, it := range items {
		switch v := it.Value.(type) {
		case string:
			out = append(out, attribute.String(it.Key, v))
		case bool:
			out = append(out, attribute.Bool(it.Key, v))
		case int:
			out = append(out, attribute.Int(it.Key, v))
		case int64:
			out = append(out, attribute.Int64(it.Key, v))
		case float64:
			out = append(out, attribute.Float64(it.Key, v))
		}
	}
	return out
}
