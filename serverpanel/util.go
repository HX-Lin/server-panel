package serverpanel

import (
	"crypto/hmac"
	"strconv"
)

type ConfigError struct {
	Message string
}

func (e *ConfigError) Error() string {
	return e.Message
}

func secureEqual(left, right string) bool {
	return hmac.Equal([]byte(left), []byte(right))
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func itoa64(value int64) string {
	return strconv.FormatInt(value, 10)
}
