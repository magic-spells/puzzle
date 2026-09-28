package expr

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// print.go renders a tree as the compact S-expression the conformance
// fixtures use. Positions are not printed; the fixtures check them only for
// errors. The forms:
//
//	1.5  'text'  true  false  null  undefined        literals
//	name                                             Identifier
//	(tpl 'a ' x ' b')                                TemplateLiteral
//	(. a b)  (?. a b)  ([] a i)  (?.[] a i)          Member
//	(call callee arg…)                               Call
//	(global Math.round)  (global Number)             Global
//	(=> (x i) body)                                  Arrow
//	(! x)  (- x)  (+ x)                              Unary
//	(+ a b)  (=== a b)  (&& a b)  (?? a b)           Binary and Logical
//	(? test then else)                               Conditional
//	(array a b)                                      Array
//	(object (k v) ('a b' v) (s))                     Object; (s) is shorthand
//	(chain …)                                        Chain
//
// Strings print single-quoted, with \\ \' \n \r \t escaped and any other
// control or line-separator character as \u{…}. Numbers print as JavaScript's
// Number.prototype.toString prints them (FormatNumber).

// Print renders n as an S-expression.
func Print(n Node) string {
	var b strings.Builder
	printNode(&b, n)
	return b.String()
}

func printNode(b *strings.Builder, n Node) {
	switch n := n.(type) {
	case *Literal:
		switch n.Kind {
		case LitString:
			b.WriteString(quote(n.Str))
		case LitNumber:
			b.WriteString(FormatNumber(n.Num))
		case LitBool:
			b.WriteString(strconv.FormatBool(n.Bool))
		case LitNull:
			b.WriteString("null")
		case LitUndefined:
			b.WriteString("undefined")
		}
	case *Identifier:
		b.WriteString(n.Name)
	case *TemplateLiteral:
		b.WriteString("(tpl ")
		b.WriteString(quote(n.Quasis[0]))
		for i, e := range n.Exprs {
			b.WriteByte(' ')
			printNode(b, e)
			b.WriteByte(' ')
			b.WriteString(quote(n.Quasis[i+1]))
		}
		b.WriteByte(')')
	case *Member:
		op := "."
		switch {
		case n.Computed && n.Optional:
			op = "?.[]"
		case n.Computed:
			op = "[]"
		case n.Optional:
			op = "?."
		}
		b.WriteString("(" + op + " ")
		printNode(b, n.Object)
		b.WriteByte(' ')
		if n.Computed {
			printNode(b, n.Index)
		} else {
			b.WriteString(n.Property)
		}
		b.WriteByte(')')
	case *Call:
		b.WriteString("(call ")
		printNode(b, n.Callee)
		for _, a := range n.Args {
			b.WriteByte(' ')
			printNode(b, a)
		}
		b.WriteByte(')')
	case *Global:
		b.WriteString("(global ")
		if n.Namespace != "" {
			b.WriteString(n.Namespace + ".")
		}
		b.WriteString(n.Name + ")")
	case *Arrow:
		b.WriteString("(=> (")
		for i, p := range n.Params {
			if i > 0 {
				b.WriteByte(' ')
			}
			b.WriteString(p.Name)
		}
		b.WriteString(") ")
		printNode(b, n.Body)
		b.WriteByte(')')
	case *Unary:
		b.WriteString("(" + n.Op + " ")
		printNode(b, n.Operand)
		b.WriteByte(')')
	case *Binary:
		printBinary(b, n.Op, n.Left, n.Right)
	case *Logical:
		printBinary(b, n.Op, n.Left, n.Right)
	case *Conditional:
		b.WriteString("(? ")
		printNode(b, n.Test)
		b.WriteByte(' ')
		printNode(b, n.Consequent)
		b.WriteByte(' ')
		printNode(b, n.Alternate)
		b.WriteByte(')')
	case *Array:
		b.WriteString("(array")
		for _, e := range n.Elements {
			b.WriteByte(' ')
			printNode(b, e)
		}
		b.WriteByte(')')
	case *Object:
		b.WriteString("(object")
		for _, e := range n.Entries {
			b.WriteString(" (")
			if isPlainName(e.Key) {
				b.WriteString(e.Key)
			} else {
				b.WriteString(quote(e.Key))
			}
			if !e.Shorthand {
				b.WriteByte(' ')
				printNode(b, e.Value)
			}
			b.WriteByte(')')
		}
		b.WriteByte(')')
	case *Chain:
		b.WriteString("(chain ")
		printNode(b, n.Expr)
		b.WriteByte(')')
	default:
		fmt.Fprintf(b, "(unknown %T)", n)
	}
}

func printBinary(b *strings.Builder, op string, l, r Node) {
	b.WriteString("(" + op + " ")
	printNode(b, l)
	b.WriteByte(' ')
	printNode(b, r)
	b.WriteByte(')')
}

// isPlainName reports whether an object key prints bare: a name that lexes as
// one identifier token.
func isPlainName(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if i == 0 && !isIDStart(r) || i > 0 && !isIDContinue(r) {
			return false
		}
	}
	return true
}

// quote renders s single-quoted for the S-expression form.
func quote(s string) string {
	var b strings.Builder
	b.WriteByte('\'')
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		switch {
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\'':
			b.WriteString(`\'`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20 || r == 0x7f || r == 0x2028 || r == 0x2029 || r == utf8.RuneError:
			fmt.Fprintf(&b, `\u{%X}`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('\'')
	return b.String()
}

// FormatNumber formats f as JavaScript's Number.prototype.toString() does:
// the shortest digits that round-trip, integer form up to 1e21, exponent
// form below 1e-6 and from 1e21 up, "-0" as "0", and NaN / Infinity by name.
func FormatNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	case f < 0:
		return "-" + FormatNumber(-f)
	}
	// Shortest round-trip digits and the decimal exponent: f = 0.d1d2…dk × 10^n.
	e := strconv.FormatFloat(f, 'e', -1, 64)
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	x, _ := strconv.Atoi(exp)
	k, n := len(digits), x+1
	switch {
	case k <= n && n <= 21:
		return digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return "0." + strings.Repeat("0", -n) + digits
	}
	sign := "+"
	if n-1 < 0 {
		sign = "-"
	}
	m := n - 1
	if m < 0 {
		m = -m
	}
	out := digits[:1]
	if k > 1 {
		out += "." + digits[1:]
	}
	return out + "e" + sign + strconv.Itoa(m)
}
