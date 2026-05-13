package serverpanel

import (
	"math"
	"time"
)

func NormalizeKomariReport(report map[string]any) map[string]any {
	cpu := asMap(report["cpu"])
	ram := asMap(report["ram"])
	load := asMap(report["load"])

	ramTotal, hasRamTotal := toInt64(ram["total"])
	ramUsed, hasRamUsed := toInt64(ram["used"])

	var ramAvailable any
	if hasRamTotal && hasRamUsed {
		ramAvailable = ramTotal - ramUsed
	}

	timestamp, ok := parseTimestamp(report["updated_at"])
	if !ok {
		timestamp = time.Now().Unix()
	}

	return map[string]any{
		"hostname":       firstNonEmpty(asString(report["hostname"]), asString(report["name"]), asString(report["uuid"]), "unknown"),
		"kernel":         firstNonEmpty(asString(report["kernel"]), asString(report["kernel_version"]), "unknown"),
		"timestamp":      timestamp,
		"uptime_seconds": intOrNil(report["uptime"]),
		"cpu": map[string]any{
			"usage_percent": floatOrNil(cpu["usage"]),
			"load1":         floatOrNil(load["load1"]),
			"load5":         floatOrNil(load["load5"]),
			"load15":        floatOrNil(load["load15"]),
		},
		"memory": map[string]any{
			"total_bytes":     intOrNil(ram["total"]),
			"used_bytes":      intOrNil(ram["used"]),
			"available_bytes": ramAvailable,
			"usage_percent":   percentOrNil(ramUsed, hasRamUsed, ramTotal, hasRamTotal),
		},
		"gpus": normalizeGPUs(report["gpu"]),
		"komari": map[string]any{
			"disk":        asMap(report["disk"]),
			"network":     asMap(report["network"]),
			"swap":        asMap(report["swap"]),
			"connections": asMap(report["connections"]),
			"process":     intOrNil(report["process"]),
			"message":     asString(report["message"]),
		},
	}
}

func normalizeGPUs(raw any) []map[string]any {
	gpu := asMap(raw)
	detailed := asList(gpu["detailed_info"])
	if len(detailed) > 0 {
		items := make([]map[string]any, 0, len(detailed))
		for index, item := range detailed {
			entry := asMap(item)
			items = append(items, map[string]any{
				"index":               index,
				"name":                firstNonEmpty(asString(entry["name"]), "GPU "+itoa(index)),
				"utilization_percent": floatOrNil(entry["utilization"]),
				"memory_used_bytes":   intOrNil(entry["memory_used"]),
				"memory_total_bytes":  intOrNil(entry["memory_total"]),
				"temperature_c":       floatOrNil(entry["temperature"]),
				"power_watts":         floatOrNil(entry["power_watts"]),
			})
		}
		return items
	}

	name := firstNonEmpty(asString(gpu["name"]), "GPU 0")
	usage := floatOrNil(firstNonEmptyValue(gpu["usage"], gpu["average_usage"]))
	if name != "GPU 0" || usage != nil {
		return []map[string]any{
			{
				"index":               0,
				"name":                name,
				"utilization_percent": usage,
				"memory_used_bytes":   nil,
				"memory_total_bytes":  nil,
				"temperature_c":       nil,
				"power_watts":         nil,
			},
		}
	}
	return []map[string]any{}
}

func intOrNil(value any) any {
	if number, ok := toInt64(value); ok {
		return number
	}
	return nil
}

func floatOrNil(value any) any {
	if number, ok := toFloat64(value); ok {
		return number
	}
	return nil
}

func toInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), true
	case float32:
		return int64(typed), true
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case int32:
		return int64(typed), true
	case jsonNumber:
		number, err := typed.Int64()
		if err == nil {
			return number, true
		}
	}
	return 0, false
}

func toFloat64(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case jsonNumber:
		number, err := typed.Float64()
		if err == nil {
			return number, true
		}
	}
	return 0, false
}

type jsonNumber interface {
	Int64() (int64, error)
	Float64() (float64, error)
}

func percentOrNil(used int64, hasUsed bool, total int64, hasTotal bool) any {
	if !hasUsed || !hasTotal || total == 0 {
		return nil
	}
	return math.Round((float64(used)*100/float64(total))*10) / 10
}

func parseTimestamp(value any) (int64, bool) {
	return toInt64(value)
}

func firstNonEmptyValue(values ...any) any {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if typed != "" {
				return typed
			}
		case nil:
		default:
			return typed
		}
	}
	return nil
}
