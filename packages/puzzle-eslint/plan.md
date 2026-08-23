# Puzzle ESLint Plugin - Comprehensive Development Plan

## 🎯 Project Overview

An ESLint plugin for linting Puzzle Framework `.pzl` single-file components, providing code quality enforcement, error detection, and best practice guidance across template syntax, JavaScript logic, and CSS styles.

---

## 📋 .pzl File Structure & Linting Scope

### **Complete .pzl File Anatomy for Linting**
```pzl
// 1. IMPORTS SECTION - JavaScript Linting
import ComponentName from './ComponentName.pzl'           // ✓ Valid import
import { User, Post } from '../models/index.js'          // ✓ Valid destructuring
import NonExistentComponent from './Missing.pzl'         // ❌ Missing file

// 2. TEMPLATE SECTION - Custom Puzzle Linting
<puzzle-view class="component-name">
  <h1>{ title | capitalize }</h1>                        // ✓ Valid expression
  <div>{ undefinedVariable }</div>                        // ❌ Undefined variable

  {#if condition}                                         // ✓ Valid control flow
    <ComponentName prop={ validProp } />                  // ✓ Valid component usage
    <NonExistentComponent />                              // ❌ Component not imported
    <button @click={ handleClick }>Click</button>         // ✓ Valid event handler
    <button @click={ nonExistentHandler }>Click</button>  // ❌ Handler not defined
  {:elsif anotherCondition}
    <div class={ dynamicClass }>Content</div>            // ✓ Valid dynamic attribute
  {:else}
    <div>Default content</div>
  {/if}

  {#each items as item, index}                           // ✓ Valid each loop
    <div key={ item.id }>{ item.name }</div>             // ✓ Good practice: key attribute
  {/each}

  {#each users as user}                                  // ❌ Missing index parameter convention
    <div>{ user.name }</div>
  {/each}
</puzzle-view>

// 3. SCRIPT SECTION - JavaScript + Puzzle-specific Linting
<script>
export default class ComponentName extends PuzzleView {  // ✓ Correct base class
  load(params, props) {                                  // ✓ Required method
    return {
      title: props.title || 'Default',                   // ✓ Valid data return
      items: [],
      undefinedInTemplate: 'value'                       // ❌ Unused in template
    };
  }

  events: {                                              // ✓ Events object
    handleClick: (event) => {                            // ✓ Referenced in template
      console.log('clicked');
    },
    unusedHandler: () => {                               // ❌ Defined but not used
      console.log('never called');
    }
  },

  // Missing computed properties referenced in template    // ❌ dynamicClass not defined

  mounted() {                                            // ✓ Valid lifecycle method
    // Component logic
  }
}
</script>

// 4. STYLE SECTION - CSS Linting + Scoped Rules
<style scoped>
.component-name {                                        // ✓ Matches puzzle-view class
  padding: 1rem;
  background: #ff0000;                                   // ❌ Prefer CSS variables
}

.unused-class {                                          // ❌ Defined but not used
  color: blue;
}

.dynamic-class {                                         // ✓ Referenced in template
  font-weight: bold;
}
</style>
```

---

## 🔍 Linting Rules Categories

### **1. Template Syntax Rules**

#### **1.1 Variable & Expression Rules**
- `puzzle/no-undefined-variables` - Variables must be defined in `load()` return
- `puzzle/no-unused-data` - Data returned from `load()` should be used in template
- `puzzle/expression-complexity` - Limit complex expressions in templates
- `puzzle/no-side-effects-in-expressions` - Expressions should be pure
- `puzzle/filter-exists` - Validate that filters are registered

#### **1.2 Control Flow Rules**
- `puzzle/valid-control-flow` - Proper `{#if}`, `{#each}`, `{#case}` syntax
- `puzzle/no-empty-blocks` - Control flow blocks must have content
- `puzzle/prefer-unless-over-negated-if` - Use `{#unless}` instead of `{#if !condition}`
- `puzzle/each-block-key` - Recommend key attributes in each blocks
- `puzzle/no-nested-each-same-variable` - Avoid variable name conflicts

#### **1.3 Component Usage Rules**
- `puzzle/component-exists` - Components must be imported
- `puzzle/valid-component-props` - Props must match component interface
- `puzzle/component-naming` - Enforce PascalCase for components
- `puzzle/self-closing-components` - Prefer self-closing syntax when appropriate
- `puzzle/component-prop-casing` - Enforce camelCase for props

#### **1.4 Event Handler Rules**
- `puzzle/event-handler-exists` - Event handlers must be defined in `events` object
- `puzzle/valid-event-names` - Use standard DOM event names
- `puzzle/no-inline-handlers` - Discourage complex inline event handlers
- `puzzle/event-handler-naming` - Enforce naming conventions (handle*, on*)

### **2. Script Section Rules**

#### **2.1 Class Structure Rules**
- `puzzle/extends-puzzle-view` - Component must extend PuzzleView
- `puzzle/require-load-method` - Components should have load() method
- `puzzle/load-method-signature` - Validate load(params, props) signature
- `puzzle/return-object-from-load` - load() must return object
- `puzzle/no-constructor` - Discourage manual constructors

#### **2.2 Lifecycle & Methods Rules**
- `puzzle/valid-lifecycle-methods` - Only use supported lifecycle methods
- `puzzle/lifecycle-method-signature` - Validate method signatures
- `puzzle/no-arrow-functions-in-class` - Use regular methods for class methods
- `puzzle/events-object-structure` - Validate events object format

#### **2.3 Data Flow Rules**
- `puzzle/no-direct-dom-manipulation` - Use reactive data instead
- `puzzle/no-global-state-mutation` - Avoid mutating global state
- `puzzle/prefer-setData` - Use this.setData() for state updates
- `puzzle/no-async-in-load` - load() method should be synchronous

#### **2.4 Import & Export Rules**
- `puzzle/valid-imports` - Validate import paths and existence
- `puzzle/no-unused-imports` - Remove unused component imports
- `puzzle/import-component-naming` - Imported components should be PascalCase
- `puzzle/default-export-required` - Must have default export

### **3. Style Section Rules**

#### **3.1 Scoped Styles Rules**
- `puzzle/scoped-styles-recommended` - Recommend scoped styles
- `puzzle/class-name-matches-component` - Root class should match component
- `puzzle/no-unused-styles` - Remove unused CSS classes
- `puzzle/style-references-template` - CSS classes should be used in template

#### **3.2 CSS Best Practices**
- `puzzle/prefer-css-variables` - Use CSS custom properties
- `puzzle/no-hardcoded-colors` - Prefer design system colors
- `puzzle/responsive-design` - Encourage responsive patterns
- `puzzle/accessibility-styles` - Ensure accessible styling

### **4. Cross-Section Rules**

#### **4.1 Template ↔ Script Integration**
- `puzzle/template-data-binding` - Template variables must exist in load() return
- `puzzle/event-handler-binding` - Template events must exist in events object
- `puzzle/computed-property-usage` - Validate computed property references

#### **4.2 Template ↔ Style Integration**
- `puzzle/class-exists-in-styles` - CSS classes used in template must be defined
- `puzzle/style-class-naming` - Enforce consistent class naming

#### **4.3 Import ↔ Usage Integration**
- `puzzle/imported-component-usage` - Imported components should be used
- `puzzle/component-usage-imported` - Used components must be imported

---

## 🛠️ Technical Implementation Architecture

### **Phase 1: Parser & AST Analysis**

#### **1.1 Multi-Section Parser**
```typescript
interface PuzzleAST {
  imports: ImportSection
  template: TemplateSection
  scripts: ScriptSection
  styles: StyleSection
  sourceMap: SourceMap
}

interface TemplateSection {
  expressions: PuzzleExpression[]
  controlFlow: ControlFlowBlock[]
  components: ComponentUsage[]
  events: EventBinding[]
  variables: VariableReference[]
}

interface ScriptSection {
  classDeclaration: ClassDeclaration
  loadMethod?: LoadMethod
  eventsObject?: EventsObject
  lifecycleMethods: LifecycleMethod[]
  computedProperties: ComputedProperty[]
}
```

#### **1.2 Cross-Reference Analysis**
```typescript
class CrossReferenceAnalyzer {
  analyzeTemplateDataBindings(template: TemplateSection, script: ScriptSection): DataBinding[]
  analyzeEventBindings(template: TemplateSection, script: ScriptSection): EventBinding[]
  analyzeComponentUsage(template: TemplateSection, imports: ImportSection): ComponentUsage[]
  analyzeStyleUsage(template: TemplateSection, styles: StyleSection): StyleUsage[]
}
```

### **Phase 2: Rule Implementation Framework**

#### **2.1 Base Rule Structure**
```typescript
abstract class PuzzleRule extends ESLintRule {
  abstract checkTemplate(node: TemplateNode): void
  abstract checkScript(node: ScriptNode): void
  abstract checkStyle(node: StyleNode): void
  abstract checkCrossReferences(ast: PuzzleAST): void
}

class VariableDefinitionRule extends PuzzleRule {
  checkTemplate(node: TemplateNode) {
    // Find all variable references in expressions
    const variables = this.extractVariables(node)

    // Check against script section
    variables.forEach(variable => {
      if (!this.isDefinedInLoad(variable)) {
        this.report({
          node,
          messageId: 'undefinedVariable',
          data: { variable: variable.name }
        })
      }
    })
  }
}
```

#### **2.2 Context Tracking**
```typescript
class PuzzleContext {
  definedVariables: Set<string> = new Set()
  definedEvents: Set<string> = new Set()
  importedComponents: Map<string, ComponentImport> = new Map()
  usedClasses: Set<string> = new Set()

  addVariable(name: string, source: 'load' | 'computed' | 'param') {
    this.definedVariables.add(name)
  }

  isVariableDefined(name: string): boolean {
    return this.definedVariables.has(name)
  }
}
```

### **Phase 3: Rule Categories Implementation**

#### **3.1 Template Expression Rules**
```typescript
// puzzle/no-undefined-variables
class NoUndefinedVariablesRule extends PuzzleRule {
  checkTemplate(node: TemplateNode) {
    if (node.type === 'PuzzleExpression') {
      const variables = this.extractVariableReferences(node.content)

      variables.forEach(variable => {
        if (!this.context.isVariableDefined(variable.name)) {
          this.report({
            node: variable,
            messageId: 'undefinedVariable',
            data: { name: variable.name },
            suggest: this.generateSuggestions(variable.name)
          })
        }
      })
    }
  }
}

// puzzle/filter-exists
class FilterExistsRule extends PuzzleRule {
  private registeredFilters = new Set([
    'capitalize', 'uppercase', 'lowercase', 'truncate',
    'date', 'currency', 'join', 'sort', 'reverse'
  ])

  checkTemplate(node: TemplateNode) {
    if (node.type === 'PuzzleExpression' && node.filters) {
      node.filters.forEach(filter => {
        if (!this.registeredFilters.has(filter.name)) {
          this.report({
            node: filter,
            messageId: 'unknownFilter',
            data: { name: filter.name }
          })
        }
      })
    }
  }
}
```

#### **3.2 Component Usage Rules**
```typescript
// puzzle/component-exists
class ComponentExistsRule extends PuzzleRule {
  checkTemplate(node: TemplateNode) {
    if (node.type === 'ComponentUsage') {
      const componentName = node.name

      if (!this.context.importedComponents.has(componentName)) {
        this.report({
          node,
          messageId: 'componentNotImported',
          data: { name: componentName },
          fix: (fixer) => this.generateImportFix(fixer, componentName)
        })
      }
    }
  }
}

// puzzle/component-prop-casing
class ComponentPropCasingRule extends PuzzleRule {
  checkTemplate(node: TemplateNode) {
    if (node.type === 'ComponentUsage') {
      node.attributes.forEach(attr => {
        if (attr.type === 'prop' && !this.isCamelCase(attr.name)) {
          this.report({
            node: attr,
            messageId: 'propShouldBeCamelCase',
            data: { name: attr.name, suggested: this.toCamelCase(attr.name) },
            fix: (fixer) => fixer.replaceText(attr, this.toCamelCase(attr.name))
          })
        }
      })
    }
  }
}
```

#### **3.3 Event Handler Rules**
```typescript
// puzzle/event-handler-exists
class EventHandlerExistsRule extends PuzzleRule {
  checkTemplate(node: TemplateNode) {
    if (node.type === 'EventBinding') {
      const handlerName = node.handler

      if (!this.context.definedEvents.has(handlerName)) {
        this.report({
          node,
          messageId: 'eventHandlerNotDefined',
          data: { name: handlerName },
          fix: (fixer) => this.generateEventHandlerFix(fixer, handlerName)
        })
      }
    }
  }

  private generateEventHandlerFix(fixer: Fixer, handlerName: string) {
    // Add handler to events object
    const eventsObject = this.findEventsObject()
    if (eventsObject) {
      return fixer.insertTextAfter(eventsObject.lastProperty,
        `,\n    ${handlerName}: (event) => {\n      // TODO: Implement handler\n    }`
      )
    }
  }
}
```

### **Phase 4: Configuration & Integration**

#### **4.1 ESLint Configuration**
```javascript
// .eslintrc.js
module.exports = {
  plugins: ['puzzle'],
  extends: ['plugin:puzzle/recommended'],
  rules: {
    // Template rules
    'puzzle/no-undefined-variables': 'error',
    'puzzle/no-unused-data': 'warn',
    'puzzle/component-exists': 'error',
    'puzzle/event-handler-exists': 'error',

    // Script rules
    'puzzle/extends-puzzle-view': 'error',
    'puzzle/require-load-method': 'warn',
    'puzzle/no-direct-dom-manipulation': 'error',

    // Style rules
    'puzzle/scoped-styles-recommended': 'warn',
    'puzzle/no-unused-styles': 'warn',

    // Cross-section rules
    'puzzle/template-data-binding': 'error',
    'puzzle/class-exists-in-styles': 'warn'
  },
  settings: {
    puzzle: {
      registeredFilters: ['capitalize', 'truncate', 'currency'],
      componentPaths: ['./src/components/**/*.pzl'],
      modelPaths: ['./src/models/**/*.js']
    }
  }
}
```

#### **4.2 Rule Configurations**
```typescript
// Individual rule configurations
const ruleConfigs = {
  'no-undefined-variables': {
    type: 'problem',
    docs: {
      description: 'Disallow undefined variables in template expressions',
      category: 'Possible Errors',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowGlobals: { type: 'boolean' },
          ignorePatterns: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: false
      }
    ],
    messages: {
      undefinedVariable: 'Variable "{{ name }}" is not defined in load() method',
      suggestDefineVariable: 'Define "{{ name }}" in load() method return object'
    }
  }
}
```

---

## 🧪 Comprehensive Test Cases

### **1. Template Syntax Error Cases**
```pzl
<!-- Undefined variable -->
<div>{ nonExistentVar }</div>

<!-- Invalid filter -->
<div>{ text | unknownFilter }</div>

<!-- Missing component import -->
<NonImportedComponent />

<!-- Undefined event handler -->
<button @click={ missingHandler }>Click</button>

<!-- Complex expression (warning) -->
<div>{ users.filter(u => u.active).map(u => u.posts.filter(p => p.published).length).reduce((a, b) => a + b, 0) }</div>
```

### **2. Script Section Error Cases**
```javascript
// Wrong base class
export default class Component extends React.Component { } // ❌

// Missing load method
export default class Component extends PuzzleView {
  // No load method
}

// Unused data
export default class Component extends PuzzleView {
  load() {
    return {
      usedData: 'value',
      unusedData: 'never referenced' // ❌
    }
  }
}

// Undefined event handler in template
export default class Component extends PuzzleView {
  events: {
    existingHandler: () => {},
    // Missing: missingHandler referenced in template
  }
}
```

### **3. Cross-Reference Error Cases**
```pzl
<!-- Template uses undefined data -->
<div>{ title }</div> <!-- title not in load() return -->

<!-- Style class not used -->
<puzzle-view class="component">
  <div class="used-class">Content</div>
</puzzle-view>

<style scoped>
.component { } /* ✓ Used */
.used-class { } /* ✓ Used */
.unused-class { } /* ❌ Never referenced */
</style>
```

### **4. Valid Code Examples**
```pzl
import Button from './Button.pzl'

<puzzle-view class="user-profile">
  <h1>{ user.name | capitalize }</h1>

  {#if user.isActive}
    <Button @click={ handleEdit } variant="primary">
      Edit Profile
    </Button>
  {/if}

  {#each user.posts as post, index}
    <article key={ post.id }>
      <h2>{ post.title }</h2>
    </article>
  {/each}
</puzzle-view>

<script>
export default class UserProfile extends PuzzleView {
  load(params, props) {
    return {
      user: props.user || {}
    }
  }

  events: {
    handleEdit: (event) => {
      this.ctx.router.push('/edit')
    }
  }
}
</script>

<style scoped>
.user-profile {
  padding: 2rem;
}
</style>
```

---

## 🚀 Implementation Roadmap

### **Phase 1: Core Infrastructure (Weeks 1-3)**
- [ ] Basic .pzl file parsing
- [ ] AST generation for all sections
- [ ] ESLint plugin framework setup
- [ ] Basic rule registration system

### **Phase 2: Template Rules (Weeks 4-6)**
- [ ] Variable definition validation
- [ ] Component import checking
- [ ] Event handler validation
- [ ] Control flow syntax validation
- [ ] Filter existence checking

### **Phase 3: Script Rules (Weeks 7-8)**
- [ ] Class structure validation
- [ ] Load method requirements
- [ ] Events object validation
- [ ] Lifecycle method checking
- [ ] Data flow analysis

### **Phase 4: Cross-Reference Rules (Weeks 9-10)**
- [ ] Template-script data binding
- [ ] Component usage validation
- [ ] Style-template integration
- [ ] Import-usage correlation

### **Phase 5: Advanced Features (Weeks 11-12)**
- [ ] Auto-fix capabilities
- [ ] Performance optimization
- [ ] Configuration options
- [ ] IDE integration

### **Phase 6: Testing & Release (Weeks 13-14)**
- [ ] Comprehensive test suite
- [ ] Documentation
- [ ] NPM package
- [ ] Community feedback

---

## 📊 Rule Severity & Recommendations

### **Error Level Rules** (Build Breaking)
- `puzzle/no-undefined-variables` - Critical runtime errors
- `puzzle/component-exists` - Import/component resolution
- `puzzle/extends-puzzle-view` - Framework requirements
- `puzzle/event-handler-exists` - Runtime event errors

### **Warning Level Rules** (Code Quality)
- `puzzle/no-unused-data` - Performance and clarity
- `puzzle/require-load-method` - Best practices
- `puzzle/scoped-styles-recommended` - Style encapsulation
- `puzzle/no-unused-styles` - Bundle size optimization

### **Info Level Rules** (Suggestions)
- `puzzle/prefer-unless-over-negated-if` - Readability
- `puzzle/component-prop-casing` - Naming conventions
- `puzzle/each-block-key` - Performance recommendations

---

## 🔧 Integration Points

### **VSCode Extension Integration**
```typescript
// Add to puzzle-vscode extension
export function activate(context: vscode.ExtensionContext) {
  // Register ESLint integration
  const eslintExtension = vscode.extensions.getExtension('dbaeumer.vscode-eslint')

  if (eslintExtension) {
    // Configure ESLint for .pzl files
    const config = vscode.workspace.getConfiguration('eslint')
    config.update('validate', ['javascript', 'puzzle'], true)
  }
}
```

### **Build Tool Integration**
```javascript
// Webpack integration
module.exports = {
  module: {
    rules: [
      {
        test: /\.pzl$/,
        enforce: 'pre',
        use: ['eslint-loader'],
        options: {
          configFile: '.eslintrc.puzzle.js'
        }
      }
    ]
  }
}
```

### **CI/CD Integration**
```yaml
# GitHub Actions
- name: Lint Puzzle Components
  run: |
    npm run lint:puzzle
    npm run lint:puzzle -- --format=junit --output-file=lint-results.xml
```

---

## 📈 Success Metrics

### **Code Quality Metrics**
- [ ] Reduce template runtime errors by 80%
- [ ] Catch 95% of component integration issues at lint time
- [ ] Improve code consistency across team projects

### **Developer Experience Metrics**
- [ ] < 100ms lint time for typical .pzl files
- [ ] Clear, actionable error messages
- [ ] Auto-fix capability for 60% of issues
- [ ] Seamless IDE integration

### **Adoption Metrics**
- [ ] Used in 90% of Puzzle projects
- [ ] Positive developer feedback (4.5+ stars)
- [ ] Active community rule contributions

---

*This comprehensive plan establishes the foundation for a robust, production-ready ESLint plugin that will significantly improve code quality and developer experience in Puzzle Framework projects.*
