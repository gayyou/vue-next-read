import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, extend, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
// 键值对都是原生的不是代理的
type KeyToDepMap = Map<any, Dep>
// TODO 这个东西是以对象作为键值得到DepMap，很巧妙，因为每个对象都有hashCode，有两个好处
//  1. 一个Vue项目中，肯定有很多需要用到数据响应的对象的数组（待修改）
//  2.
//  缺点：
//  WeakMap说到底Map就是一个哈希表，总会有冲突的时候，数量一多，它就冲突了，冲突后就用红黑树来解决冲突，如果红黑树过大，开销会很多
//  targetMap的键值对都是原生的，而不是代理后的
const targetMap = new WeakMap<any, KeyToDepMap>()

/**
 * @description 相当于Vue2.0的Watcher
 */
export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = []
export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol('iterate')

// 用vue2.0来判断的话，就是判断是否是一个Watcher
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  if (!effect.active) {
    return fn(...args)
  }
  if (!effectStack.includes(effect)) {
    cleanup(effect)
    try {
      effectStack.push(effect)
      activeEffect = effect
      return fn(...args)
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1]
    }
  }
}

function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true

export function pauseTracking() {
  shouldTrack = false
}

export function resumeTracking() {
  shouldTrack = true
}

/**
 * @description 追踪就是依赖的添加过程，相当于2.0的observer过程
 * @param target
 * @param type
 * @param key
 */
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (dep === void 0) {
    depsMap.set(key, (dep = new Set()))
  }

  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  const depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    // TODO 为什么对数组或者对象迭代的属性进行添加呢？  这里是还没有完成部分的，可能完成后就是在依赖添加部分的时候一次性遍历整个对象的所有属性，然后添加到这个depsMap中
    // 注意到这里是增加或者删除对象或者数组的某一项，此时的length、Iterator会发生改变
    // 删除操作或者增加操作，对于数组的话，会对length进行修改，对于对象的话，会对遍历的属性进行修改，所以要把他们放到执行队列中
    if (type === TriggerOpTypes.ADD || type === TriggerOpTypes.DELETE) {
      console.log(target);
      const iterationKey = isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters can be invalidated before any normal effects that depend on them are run.
  // 重要提示：必须先运行计算的效果，以便在运行依赖于它们的任何普通效果之前，使计算的dirty无效
  // TODO 是不是缺少了nextTick，不然都放到下一个事件循环中进行操作
  //  在这里针对于不同类型的effect，会有不同的处理方式
  computedRunners.forEach(run)
  effects.forEach(run)
}

// 将effectsToAdd的结合中的所有元素按照是否是computed属性进行添加至effects和computedRunners中
function addRunners(
  effects: Set<ReactiveEffect>,                   // 最后会执行的effectSet
  computedRunners: Set<ReactiveEffect>,           // 计算属性的runner
  effectsToAdd: Set<ReactiveEffect> | undefined   // 相当于Watcher的Set
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.options.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

function scheduleRun(
  effect: ReactiveEffect,                 // 相当于watcher
  target: object,                         // 目标对象
  type: TriggerOpTypes,                   // 触发类型
  key: unknown,                           // 键值
  extraInfo?: DebuggerEventExtraInfo
) {
  if (__DEV__ && effect.options.onTrigger) {
    const event: DebuggerEvent = {
      effect,
      target,
      key,
      type
    }
    effect.options.onTrigger(extraInfo ? extend(event, extraInfo) : event)
  }
  if (effect.options.scheduler !== void 0) {
    effect.options.scheduler(effect)
  } else {
    effect()
  }
}
