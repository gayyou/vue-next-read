/**
 * @description 这个是进行举一个例子说明Vue2.0是可以对容器变成响应式对象的，这里省去了触发的代码，在Instrumentation里面可以进行追踪和触发操作
 */
const mapGet = Object.getOwnPropertyDescriptor(Map.prototype, 'get').value;
const mapSet = Object.getOwnPropertyDescriptor(Map.prototype, 'set').value;
console.log(mapSet)
console.log(mapGet)

const Instrumentation = {
  get(args) {
    // 这里可以进行更多的操作
    // 在这里进行追踪
    return mapGet.call(this, args[0]);
  },
  set(args) {
    // 在这里进行触发操作
    return mapSet.call(this, args[0], args[1]);
  }
};

function createReactiveMapper(map) {
  return (method) => () => (...key) => {
    if (Instrumentation.hasOwnProperty(method)) {
      return Instrumentation[method].call(map, key);
    } else {
      return map[key];
    }
  };
}

const collectionReactive = (map) => {
  const handler = createReactiveMapper(map);
  // 这里省略掉很多操作
  Object.defineProperty(map, 'get', {
    configurable: true,
    enumerable: true,
    get: handler('get'),
  });
  Object.defineProperty(map, 'set', {
    configurable: true,
    enumerable: true,
    get: handler('set'),
  })
};

let map = new Map();

collectionReactive(map);

map.set('abc', 123);
map.get('abc');
