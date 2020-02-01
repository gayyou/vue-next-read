// 直接给数组的超额下标赋值的话，会在底层改变数组的length
let arr = [];
arr.length;  // 0
arr[2] = 1;  // 2

// 以proxy为例子
let handler = {
  get(target, key, receiver) {
    console.log('get', key);
    return Reflect.get(target, key);
  },
  set(target, key, value) {
    console.log('set', key)
    return Reflect.set(target, key, value);
  }
};

let proxy = new Proxy([1, 2, 3, 4, 5], handler);

// proxy.push(1);
proxy.includes(1);
// get push
// get length
// set 5
// set length

// // 以proxy为例子
// let handler = {
//   get(target, key, receiver) {
//     console.log('get', key);
//     return Reflect.get(target, key);
//   },
//   set(target, key, value) {
//     console.log('set', key)
//     return Reflect.set(target, key, value);
//   }
// };
//
// let proxy = new Proxy([1, 2, 3, 4, 5], handler);
//
// proxy.push(1);
