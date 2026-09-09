# Puzzle Prettier Plugin - Comprehensive Development Plan

## 🎯 Project Overview

A Prettier plugin for formatting Puzzle Framework `.pzl` single-file components, providing consistent code formatting across HTML templates, JavaScript/TypeScript, and CSS/SCSS sections.

---

## 📋 .pzl File Structure Analysis

### **Complete .pzl File Anatomy**
```pzl
// 1. IMPORTS SECTION (optional)
import ComponentName from './ComponentName.pzl'
import { ModelName } from '../models/modelName.js'

// 2. TEMPLATE SECTION (required)
<puzzle-view class="component-name">
  <!-- HTML with Puzzle template syntax -->
  <h1>{ title | capitalize }</h1>

  {#if condition}
    <div class="content">
      {#each items as item, index}
        <ComponentName prop={ item.value } @click={ handleClick } />
      {/each}
    </div>
  {:else}
    <div class="empty">No items</div>
  {/if}
</puzzle-view>

// 3. SCRIPT SECTION (required)
<script>
export default class ComponentName extends PuzzleView {
  load(params, props) {
    return {
      title: 'Hello World',
      items: []
    };
  }

  events: {
    handleClick: (event) => {
      // event handler logic
    }
  }
}
</script>

// 4. STYLE SECTION (optional)
<style scoped>
.component-name {
  padding: 1rem;
  border-radius: 8px;
}
</style>
```

---

## 🔍 Formatting Requirements Analysis

### **1. Import Section Formatting**
```javascript
// BEFORE (unformatted)
import Button from './Button.pzl';import Card from './Card.pzl'
import{User}from'../models/user.js'

// AFTER (formatted)
import Button from './Button.pzl'
import Card from './Card.pzl'
import { User } from '../models/user.js'
```

**Requirements:**
- Standard JavaScript import formatting
- Consistent spacing around braces
- Alphabetical ordering (optional)
- Line breaks between imports

### **2. Template Section Formatting**

#### **2.1 HTML Element Formatting**
```html
<!-- BEFORE -->
<div class="container"><h1>Title</h1><p>Content</p></div>

<!-- AFTER -->
<div class="container">
  <h1>Title</h1>
  <p>Content</p>
</div>
```

#### **2.2 Puzzle Expression Formatting**
```html
<!-- BEFORE -->
{user.name|capitalize|truncate(20)}
{ items.length>0?'has items':'empty' }

<!-- AFTER -->
{ user.name | capitalize | truncate(20) }
{ items.length > 0 ? 'has items' : 'empty' }
```

#### **2.3 Control Flow Formatting**
```html
<!-- BEFORE -->
{#if loading}<div>Loading...</div>{:elsif error}<div>Error</div>{:else}<div>Content</div>{/if}

<!-- AFTER -->
{#if loading}
  <div>Loading...</div>
{:elsif error}
  <div>Error</div>
{:else}
  <div>Content</div>
{/if}
```

#### **2.4 Component Usage Formatting**
```html
<!-- BEFORE -->
<Button @click={handleClick}variant="primary"disabled={isLoading}>Click me</Button>

<!-- AFTER -->
<Button
  @click={ handleClick }
  variant="primary"
  disabled={ isLoading }
>
  Click me
</Button>
```

#### **2.5 Event Handler Formatting**
```html
<!-- BEFORE -->
<button @click={handleClick}@keydown:enter={handleSubmit}>

<!-- AFTER -->
<button
  @click={ handleClick }
  @keydown:enter={ handleSubmit }
>
```

### **3. Script Section Formatting**
```javascript
// BEFORE
<script>
export default class Component extends PuzzleView{load(params,props){return{data:props.data||[]};}events:{handleClick:(event)=>{console.log('clicked');}}}
</script>

// AFTER
<script>
export default class Component extends PuzzleView {
  load(params, props) {
    return {
      data: props.data || []
    };
  }

  events: {
    handleClick: (event) => {
      console.log('clicked');
    }
  }
}
</script>
```

### **4. Style Section Formatting**
```css
/* BEFORE */
<style scoped>
.component{padding:1rem;background:red;}.item{margin:0.5rem;}
</style>

/* AFTER */
<style scoped>
.component {
  padding: 1rem;
  background: red;
}

.item {
  margin: 0.5rem;
}
</style>
```

---

## 🛠️ Technical Implementation Strategy

### **Phase 1: Parser Architecture**

#### **1.1 Multi-Language Parser Chain**
```typescript
interface PuzzleParser {
  parseImports(source: string): ImportSection
  parseTemplate(source: string): TemplateSection
  parseScript(source: string): ScriptSection
  parseStyle(source: string): StyleSection
}

interface TemplateSection {
  expressions: PuzzleExpression[]
  controlFlow: ControlFlowBlock[]
  elements: HTMLElement[]
  components: ComponentUsage[]
}
```

#### **1.2 AST Node Types**
```typescript
// Puzzle-specific AST nodes
type PuzzleExpression = {
  type: 'expression'
  content: string
  filters: Filter[]
  location: SourceLocation
}

type ControlFlowBlock = {
  type: 'if' | 'each' | 'unless' | 'case'
  condition: string
  children: TemplateNode[]
  branches?: Branch[]
  location: SourceLocation
}

type ComponentUsage = {
  type: 'component'
  name: string
  attributes: Attribute[]
  events: EventHandler[]
  children: TemplateNode[]
  location: SourceLocation
}
```

### **Phase 2: Formatter Implementation**

#### **2.1 Section-Specific Formatters**
```typescript
class PuzzleFormatter {
  formatImports(section: ImportSection): string
  formatTemplate(section: TemplateSection): string
  formatScript(section: ScriptSection): string
  formatStyle(section: StyleSection): string
}
```

#### **2.2 Template Expression Formatter**
```typescript
class ExpressionFormatter {
  formatInterpolation(expr: PuzzleExpression): string {
    // { value | filter1 | filter2(arg) }
    const base = expr.content.trim()
    const filters = expr.filters.map(f => this.formatFilter(f)).join(' | ')
    return `{ ${base}${filters ? ' | ' + filters : ''} }`
  }

  formatControlFlow(block: ControlFlowBlock): string {
    // Multi-line control flow formatting
    const condition = block.condition.trim()
    const children = this.formatChildren(block.children)
    return `{#${block.type} ${condition}}\n${children}\n{/${block.type}}`
  }
}
```

#### **2.3 Component Formatter**
```typescript
class ComponentFormatter {
  formatComponent(comp: ComponentUsage): string {
    const attrs = this.formatAttributes(comp.attributes)
    const events = this.formatEvents(comp.events)

    if (this.shouldUseMultiLine(comp)) {
      return this.formatMultiLineComponent(comp)
    }
    return this.formatSingleLineComponent(comp)
  }

  private formatEvents(events: EventHandler[]): string {
    return events.map(e => `@${e.name}={ ${e.handler} }`).join('\n  ')
  }
}
```

### **Phase 3: Integration with Prettier**

#### **3.1 Prettier Plugin Structure**
```typescript
// prettier-plugin-puzzle/src/index.ts
import { Parser, Printer } from 'prettier'

export const languages = [
  {
    name: 'puzzle',
    parsers: ['puzzle'],
    extensions: ['.pzl'],
    vscodeLanguageIds: ['puzzle']
  }
]

export const parsers = {
  puzzle: {
    parse: (text: string, options: any) => parsePuzzle(text, options),
    astFormat: 'puzzle-ast',
    locStart: (node: any) => node.start,
    locEnd: (node: any) => node.end
  }
}

export const printers = {
  'puzzle-ast': {
    print: (path: any, options: any, print: any) => printPuzzle(path, options, print)
  }
}
```

#### **3.2 Options Configuration**
```typescript
export const options = {
  puzzleIndentWidth: {
    type: 'int',
    default: 2,
    description: 'Indent width for Puzzle templates'
  },
  puzzleAttributeBreaking: {
    type: 'choice',
    default: 'auto',
    choices: ['auto', 'always', 'never'],
    description: 'When to break component attributes'
  },
  puzzleExpressionSpacing: {
    type: 'boolean',
    default: true,
    description: 'Add spaces around expression braces'
  }
}
```

---

## 📐 Formatting Rules & Standards

### **1. Indentation Rules**
- **Base indent**: 2 spaces (configurable)
- **Template nesting**: Each control flow block adds one indent level
- **Component attributes**: When multi-line, indent by one level
- **Script/Style content**: Follow language-specific rules

### **2. Line Breaking Rules**
- **Component attributes**: Break when > 80 characters or > 3 attributes
- **Control flow**: Always multi-line
- **Expressions**: Single line unless complex
- **Import statements**: One per line

### **3. Spacing Rules**
- **Expression braces**: `{ expression }` with spaces
- **Attribute assignment**: `prop={ value }` with spaces
- **Filter chains**: `value | filter1 | filter2` with spaces
- **Control flow**: `{#if condition}` with space after keyword

### **4. Quote Consistency**
- **HTML attributes**: Double quotes by default
- **JavaScript strings**: Follow JS prettier rules
- **CSS values**: Follow CSS prettier rules

### **5. Component Formatting**
```html
<!-- Single line (simple) -->
<Button variant="primary" @click={ handleClick }>Text</Button>

<!-- Multi-line (complex) -->
<ComplexComponent
  prop1={ longValue }
  prop2="string value"
  :disabled={ isLoading }
  @click={ handleComplexClick }
  @input={ handleInput }
>
  <span>Complex content</span>
</ComplexComponent>
```

---

## 🧪 Test Cases & Edge Cases

### **1. Complex Nested Structures**
```pzl
<puzzle-view class="complex">
  {#if user.isAuthenticated}
    {#each user.posts as post, index}
      {#if post.isPublished}
        <PostCard
          post={ post }
          index={ index }
          @edit={ (e) => editPost(post.id, e) }
          @delete={ () => deletePost(post.id) }
        >
          {#if post.hasComments}
            <CommentList comments={ post.comments } />
          {:else}
            <div class="no-comments">No comments yet</div>
          {/if}
        </PostCard>
      {/if}
    {/each}
  {:else}
    <LoginPrompt @login={ handleLogin } />
  {/if}
</puzzle-view>
```

### **2. Complex Expressions with Filters**
```html
{ user.profile.displayName || user.email | truncate(30) | capitalize }
{ posts.filter(p => p.isPublished).length > 0 ? 'Has posts' : 'No posts' }
{ formatDate(post.createdAt, 'YYYY-MM-DD') | timeAgo }
```

### **3. Mixed Quote Scenarios**
```html
<Component
  title='Single quotes'
  description="Double quotes"
  data={ objectWithQuotes }
  @click={ () => alert("Complex 'nested' quotes") }
/>
```

### **4. TypeScript in Script**
```typescript
<script lang="ts">
interface ComponentProps {
  title: string;
  items: Item[];
}

export default class TypedComponent extends PuzzleView {
  load(params: any, props: ComponentProps) {
    return {
      processedItems: props.items.map((item: Item) => ({
        ...item,
        formatted: this.formatItem(item)
      }))
    };
  }
}
</script>
```

### **5. SCSS in Style**
```scss
<style lang="scss" scoped>
$primary-color: #007bff;
$spacing: 1rem;

.component {
  padding: $spacing;

  &.active {
    background: $primary-color;

    .nested-element {
      transform: scale(1.1);
    }
  }
}
</style>
```

---

## 🚀 Implementation Phases

### **Phase 1: Core Parser (Weeks 1-2)**
- [ ] Basic .pzl file section detection
- [ ] Import statement parsing
- [ ] Template content extraction
- [ ] Script/style content extraction
- [ ] Basic AST generation

### **Phase 2: Template Formatter (Weeks 3-4)**
- [ ] HTML element formatting
- [ ] Puzzle expression formatting (`{ }` blocks)
- [ ] Control flow formatting (`{#if}`, `{#each}`, etc.)
- [ ] Component usage formatting
- [ ] Event handler formatting

### **Phase 3: Multi-Language Integration (Weeks 5-6)**
- [ ] JavaScript/TypeScript formatting in script
- [ ] CSS/SCSS formatting in style
- [ ] Import statement formatting
- [ ] Cross-section consistency

### **Phase 4: Advanced Features (Weeks 7-8)**
- [ ] Configuration options
- [ ] Performance optimization
- [ ] Error handling and recovery
- [ ] VSCode integration
- [ ] Testing framework

### **Phase 5: Polish & Release (Weeks 9-10)**
- [ ] Comprehensive test suite
- [ ] Documentation
- [ ] NPM package setup
- [ ] CI/CD pipeline
- [ ] Community feedback integration

---

## 📊 Technical Challenges & Solutions

### **Challenge 1: Multi-Language Parsing**
**Problem**: .pzl files contain 4 different languages
**Solution**:
- Use existing Prettier parsers for JS/CSS
- Custom parser for Puzzle template syntax
- Coordinate formatting across sections

### **Challenge 2: Expression Context Awareness**
**Problem**: `{ }` means different things in different contexts
**Solution**:
- Context-aware lexing
- Separate parsing for template expressions vs JS object literals
- Proper scope tracking

### **Challenge 3: Attribute vs Event Distinction**
**Problem**: `@click={ }` vs `class={ }` need different formatting
**Solution**:
- Pattern-based attribute detection
- Event-specific formatting rules
- Configurable spacing preferences

### **Challenge 4: Nested Template Structures**
**Problem**: Control flow blocks with nested components
**Solution**:
- Recursive AST traversal
- Proper indentation tracking
- Context-preserving formatting

### **Challenge 5: Performance with Large Files**
**Problem**: Complex .pzl files may be slow to format
**Solution**:
- Incremental parsing
- Caching strategies
- Lazy evaluation of complex expressions

---

## 🎯 Success Metrics

### **Functionality Goals**
- [ ] Correctly formats 95% of real-world .pzl files
- [ ] Preserves semantic meaning in 100% of cases
- [ ] Handles all Puzzle template syntax features
- [ ] Integrates seamlessly with existing Prettier workflows

### **Performance Goals**
- [ ] Format typical .pzl file (< 500 lines) in < 100ms
- [ ] Memory usage < 50MB for large files
- [ ] No noticeable lag in VSCode format-on-save

### **Developer Experience Goals**
- [ ] Zero-configuration setup for most users
- [ ] Clear error messages for malformed files
- [ ] Consistent with existing Prettier conventions
- [ ] Works with popular editors (VSCode, WebStorm, etc.)

---

## 📚 Dependencies & Technologies

### **Core Dependencies**
- `prettier` (peer dependency)
- Custom parser built on:
  - `@babel/parser` (for JavaScript sections)
  - `postcss` (for CSS sections)
  - Custom lexer/parser for Puzzle syntax

### **Development Dependencies**
- `typescript` - Type safety
- `jest` - Testing framework
- `@types/prettier` - Type definitions
- `rollup` - Bundle generation

### **Optional Integrations**
- `@prettier/plugin-php` - Reference implementation
- `prettier-plugin-svelte` - Similar single-file component formatting
- `eslint-plugin-prettier` - Linting integration

---

*This plan serves as the comprehensive roadmap for building a production-ready Prettier plugin for Puzzle Framework. Each phase builds upon the previous, ensuring a robust and maintainable formatting solution.*
