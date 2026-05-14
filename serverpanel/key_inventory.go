package serverpanel

import (
	"bufio"
	"fmt"
	"sort"
	"strings"
)

type AuthorizedKeyEntry struct {
	PublicKey
	RawLine     string
	OwnerToken  string
	TargetID    string
	TargetName  string
	TargetFound bool
}

type authorizedKeysSnapshot struct {
	Target    KeyTarget
	Entries    []AuthorizedKeyEntry
	ScanResult map[string]any
}

func NormalizeUserToken(raw string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if r >= 'a' && r <= 'z' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func IsUserTokenFormatValid(token string) bool {
	if len(token) < 2 || len(token) > 64 {
		return false
	}
	for _, r := range token {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func ExtractCommentOwnerToken(comment string) string {
	comment = strings.TrimSpace(comment)
	if comment == "" {
		return ""
	}

	var builder strings.Builder
	for _, r := range comment {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			builder.WriteRune(r)
			continue
		}
		if r == '-' || r == '_' || r == ' ' || r == '\t' {
			break
		}
		if builder.Len() > 0 {
			break
		}
	}
	return NormalizeUserToken(builder.String())
}

func InspectAuthorizedKeys(config *AppConfig, runner *SSHRunner, userToken string, submitted *PublicKey) (map[string]any, error) {
	if !config.KeyManagement.Enabled {
		return nil, &PublicKeyError{Message: "key management is disabled"}
	}
	if len(config.KeyManagement.Targets) == 0 {
		return nil, &PublicKeyError{Message: "no key targets configured"}
	}
	if !IsUserTokenFormatValid(userToken) {
		return nil, &PublicKeyError{Message: "invalid upload token format"}
	}

	snapshots := collectAuthorizedKeys(config, runner)

	type aggregate struct {
		Fingerprint string
		KeyType     string
		Comment     string
		PresentOn   []map[string]any
	}

	byFingerprint := map[string]*aggregate{}
	scanResults := make([]map[string]any, 0, len(snapshots))

	for _, snapshot := range snapshots {
		scanResults = append(scanResults, snapshot.ScanResult)
		for _, entry := range snapshot.Entries {
			if entry.OwnerToken != userToken {
				continue
			}

			item, ok := byFingerprint[entry.Fingerprint]
			if !ok {
				item = &aggregate{
					Fingerprint: entry.Fingerprint,
					KeyType:     entry.KeyType,
					Comment:     entry.Comment,
					PresentOn:   []map[string]any{},
				}
				byFingerprint[entry.Fingerprint] = item
			}

			item.PresentOn = append(item.PresentOn, map[string]any{
				"id":   entry.TargetID,
				"name": entry.TargetName,
			})
		}
	}

	keys := make([]map[string]any, 0, len(byFingerprint))
	for _, item := range byFingerprint {
		sort.Slice(item.PresentOn, func(i, j int) bool {
			leftName := asString(item.PresentOn[i]["name"])
			rightName := asString(item.PresentOn[j]["name"])
			if leftName == rightName {
				return asString(item.PresentOn[i]["id"]) < asString(item.PresentOn[j]["id"])
			}
			return leftName < rightName
		})

		keys = append(keys, map[string]any{
			"fingerprint":           item.Fingerprint,
			"key_type":              item.KeyType,
			"comment":               item.Comment,
			"present_on":            item.PresentOn,
			"present_on_count":      len(item.PresentOn),
			"expected_target_count": len(config.KeyManagement.Targets),
			"fully_distributed":     len(item.PresentOn) == len(config.KeyManagement.Targets),
			"duplicate_of_submitted": submitted != nil &&
				item.Fingerprint == submitted.Fingerprint,
		})
	}

	sort.Slice(keys, func(i, j int) bool {
		leftComment := asString(keys[i]["comment"])
		rightComment := asString(keys[j]["comment"])
		if leftComment == rightComment {
			return asString(keys[i]["fingerprint"]) < asString(keys[j]["fingerprint"])
		}
		return leftComment < rightComment
	})

	result := map[string]any{
		"user_token":            userToken,
		"keys":                  keys,
		"scan_results":          scanResults,
		"expected_target_count": len(config.KeyManagement.Targets),
	}
	if submitted != nil {
		result["submitted_fingerprint"] = submitted.Fingerprint
	}
	return result, nil
}

func DeleteOwnedPublicKey(config *AppConfig, runner *SSHRunner, userToken, fingerprint, actor string, allowAnyOwner bool) (map[string]any, error) {
	if !config.KeyManagement.Enabled {
		return nil, &PublicKeyError{Message: "key management is disabled"}
	}
	if len(config.KeyManagement.Targets) == 0 {
		return nil, &PublicKeyError{Message: "no key targets configured"}
	}
	fingerprint = strings.TrimSpace(fingerprint)
	if fingerprint == "" {
		return nil, &PublicKeyError{Message: "fingerprint is required"}
	}
	if !allowAnyOwner && !IsUserTokenFormatValid(userToken) {
		return nil, &PublicKeyError{Message: "invalid upload token format"}
	}

	snapshots := collectAuthorizedKeys(config, runner)
	linesByTarget := map[string][]AuthorizedKeyEntry{}
	matchedComment := ""
	matchedKeyType := ""

	for _, snapshot := range snapshots {
		for _, entry := range snapshot.Entries {
			if entry.Fingerprint != fingerprint {
				continue
			}
			if !allowAnyOwner && entry.OwnerToken != userToken {
				continue
			}
			linesByTarget[snapshot.Target.ID] = append(linesByTarget[snapshot.Target.ID], entry)
			if matchedComment == "" {
				matchedComment = entry.Comment
			}
			if matchedKeyType == "" {
				matchedKeyType = entry.KeyType
			}
		}
	}

	if len(linesByTarget) == 0 {
		if allowAnyOwner {
			return nil, &PublicKeyError{Message: "public key not found"}
		}
		return nil, &PublicKeyError{Message: "no removable public key found for this user"}
	}

	results := make([]map[string]any, 0, len(config.KeyManagement.Targets))
	for _, target := range config.KeyManagement.Targets {
		entries := linesByTarget[target.ID]
		if len(entries) == 0 {
			results = append(results, map[string]any{
				"id":      target.ID,
				"name":    target.Name,
				"status":  "missing",
				"message": "matching key not found on this target",
			})
			continue
		}

		if config.KeyManagement.DryRun {
			results = append(results, map[string]any{
				"id":      target.ID,
				"name":    target.Name,
				"status":  "planned",
				"message": fmt.Sprintf("dry_run enabled; %d matching key line(s) would be removed", len(entries)),
			})
			continue
		}

		rawLines := make([]string, 0, len(entries))
		for _, entry := range entries {
			rawLines = append(rawLines, entry.RawLine)
		}

		script := buildDeleteAuthorizedKeysScript(target, rawLines)
		runResult := runner.RunScript(target, script)
		stdout := strings.TrimSpace(runResult.Stdout)
		status := "failed"
		message := stdout

		if runResult.OK {
			switch {
			case strings.HasPrefix(stdout, "deleted:"):
				status = "deleted"
			case stdout == "missing":
				status = "missing"
			}
		}
		if !runResult.OK {
			message = firstNonEmpty(strings.TrimSpace(runResult.Stderr), stdout)
		}

		results = append(results, map[string]any{
			"id":         target.ID,
			"name":       target.Name,
			"status":     status,
			"message":    truncateString(message, 300),
			"latency_ms": runResult.LatencyMS,
		})
	}

	if err := writeDeleteAuditLog(config, fingerprint, matchedKeyType, matchedComment, actor, results); err != nil {
		return nil, err
	}

	return map[string]any{
		"fingerprint": fingerprint,
		"key_type":    matchedKeyType,
		"comment":     matchedComment,
		"dry_run":     config.KeyManagement.DryRun,
		"targets":     results,
	}, nil
}

func collectAuthorizedKeys(config *AppConfig, runner *SSHRunner) []authorizedKeysSnapshot {
	results := make([]authorizedKeysSnapshot, 0, len(config.KeyManagement.Targets))
	for _, target := range config.KeyManagement.Targets {
		script := buildReadAuthorizedKeysScript(target)
		runResult := runner.RunScript(target, script)

		scan := map[string]any{
			"id":         target.ID,
			"name":       target.Name,
			"latency_ms": runResult.LatencyMS,
		}

		if !runResult.OK {
			scan["status"] = "failed"
			scan["message"] = truncateString(firstNonEmpty(strings.TrimSpace(runResult.Stderr), strings.TrimSpace(runResult.Stdout)), 300)
			results = append(results, authorizedKeysSnapshot{
				Target:     target,
				Entries:    []AuthorizedKeyEntry{},
				ScanResult: scan,
			})
			continue
		}

		entries := parseAuthorizedKeys(runResult.Stdout, target, config.KeyManagement.AllowedKeyTypes, config.KeyManagement.AllowSSHRSA)
		scan["status"] = "ok"
		scan["message"] = fmt.Sprintf("scanned %d managed key(s)", len(entries))
		results = append(results, authorizedKeysSnapshot{
			Target:     target,
			Entries:    entries,
			ScanResult: scan,
		})
	}
	return results
}

func parseAuthorizedKeys(content string, target KeyTarget, allowedTypes []string, allowSSHRSA bool) []AuthorizedKeyEntry {
	scanner := bufio.NewScanner(strings.NewReader(content))
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)

	entries := make([]AuthorizedKeyEntry, 0)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		publicKey, ok := parseAuthorizedKeyLine(line, allowedTypes, allowSSHRSA)
		if !ok {
			continue
		}
		entries = append(entries, AuthorizedKeyEntry{
			PublicKey:   publicKey,
			RawLine:     line,
			OwnerToken:  ExtractCommentOwnerToken(publicKey.Comment),
			TargetID:    target.ID,
			TargetName:  target.Name,
			TargetFound: true,
		})
	}
	return entries
}

func parseAuthorizedKeyLine(line string, allowedTypes []string, allowSSHRSA bool) (PublicKey, bool) {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return PublicKey{}, false
	}

	allowed := allowedKeyTypeSet(allowedTypes, allowSSHRSA)
	for index := 0; index < len(fields)-1; index++ {
		if _, ok := allowed[fields[index]]; !ok {
			continue
		}
		publicKey, err := ValidatePublicKey(strings.Join(fields[index:], " "), allowedTypes, allowSSHRSA)
		if err != nil {
			return PublicKey{}, false
		}
		return publicKey, true
	}
	return PublicKey{}, false
}

func allowedKeyTypeSet(allowedTypes []string, allowSSHRSA bool) map[string]struct{} {
	set := map[string]struct{}{}
	source := allowedTypes
	if len(source) == 0 {
		source = defaultAllowedKeyTypes
	}
	for _, keyType := range source {
		set[keyType] = struct{}{}
	}
	if allowSSHRSA {
		set["ssh-rsa"] = struct{}{}
	}
	return set
}

func buildReadAuthorizedKeysScript(target KeyTarget) string {
	quotedPath := shellQuote(target.AuthorizedKeys)
	return `
set -eu
AUTH_FILE=` + quotedPath + `
case "$AUTH_FILE" in
  "~/"*) AUTH_FILE="$HOME/${AUTH_FILE#~/}" ;;
esac
if [ -f "$AUTH_FILE" ]; then
  cat "$AUTH_FILE"
fi
`
}

func buildDeleteAuthorizedKeysScript(target KeyTarget, rawLines []string) string {
	quotedPath := shellQuote(target.AuthorizedKeys)
	var builder strings.Builder
	builder.WriteString(`
set -eu
AUTH_FILE=` + quotedPath + `
case "$AUTH_FILE" in
  "~/"*) AUTH_FILE="$HOME/${AUTH_FILE#~/}" ;;
esac
if [ ! -f "$AUTH_FILE" ]; then
  printf 'missing\n'
  exit 0
fi
TMP_FILE=$(mktemp "${AUTH_FILE}.tmp.XXXXXX")
cp "$AUTH_FILE" "$TMP_FILE"
deleted=0
`)

	for _, rawLine := range rawLines {
		builder.WriteString("KEY_LINE=" + shellQuote(rawLine) + "\n")
		builder.WriteString(`
if grep -Fqx "$KEY_LINE" "$TMP_FILE" 2>/dev/null; then
  TMP_NEXT=$(mktemp "${AUTH_FILE}.tmp.XXXXXX")
  grep -Fvx "$KEY_LINE" "$TMP_FILE" > "$TMP_NEXT" || true
  mv "$TMP_NEXT" "$TMP_FILE"
  deleted=$((deleted + 1))
fi
`)
	}

	builder.WriteString(`
if [ "$deleted" -gt 0 ]; then
  mv "$TMP_FILE" "$AUTH_FILE"
  chmod 600 "$AUTH_FILE" 2>/dev/null || true
  printf 'deleted:%s\n' "$deleted"
else
  rm -f "$TMP_FILE"
  printf 'missing\n'
fi
`)

	return builder.String()
}

func writeDeleteAuditLog(config *AppConfig, fingerprint, keyType, comment, actor string, results []map[string]any) error {
	if config.AuditLog == "" {
		return nil
	}

	publicKey := PublicKey{
		Fingerprint: fingerprint,
		KeyType:     keyType,
		Comment:     comment,
	}

	return writeActionAuditLog(config, "delete", publicKey, actor, results)
}
