// 下载即梦生成的 13 张职业立绘到 assets/characters/
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets', 'characters');
fs.mkdirSync(dir, { recursive: true });

const items = [
  ['haidao', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/202608101639523571A5266A0203CF2A1D-1423-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437598&x-signature=mhkfwhmxXykcvHvEEV85nDB5voA%3D'],
  ['jiaodoushi', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/2026081016395904E0F31123BF9F55EBA7-6714-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437606&x-signature=DnFKIrtPksTYj4Yh4VamomvvnxE%3D'],
  ['fangshi', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260810163952BDFDC1F0D2C7B7F5B7C4-4741-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437598&x-signature=1zEuAyMQHUDlAQERKBdJNOSdb7w%3D'],
  ['qiangshou', 'https://p3-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260810163959BC3C8690080BB55A5870-4178-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437606&x-signature=nClASVbcENtqvnsFcY0DwcAkfWI%3D'],
  ['qishi', 'https://p9-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/202608101640171FA43907EC637CCE78CB-1174-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437624&x-signature=6pqONy9nFDUwEoZiEZ4gznA0g78%3D'],
  ['guanxingzhe', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260810164029D0BFF5A0360629596F30-4270-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437636&x-signature=eL9rxvNyuz5v%2FyOPyOIcOWtVjZY%3D'],
  ['huanfashi', 'https://p3-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/2026081016404019D6FBAA7279ABEF3EC4-4958-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437647&x-signature=cwGTHCcFcCCLnNYkTLm%2BPmb1d4o%3D'],
  ['lianjinshushi', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260810164052B5D2C9E0C08397C6E933-1491-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437659&x-signature=w1oPyEbEYEAw70j9%2BoiNnm1LuLo%3D'],
  ['zhentan', 'https://p26-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260810164103267BE27B89240E6CC306-7328-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437670&x-signature=WPnE1YMwWzZc3OMeNWlaOPjrRTQ%3D'],
  ['baifuzhang', 'https://p9-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/2026081016411423380F56B87311F073A3-9772-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437682&x-signature=rDRZg%2BRVrlL0rUEncXRp4Nb7p3E%3D'],
  ['wushi', 'https://p9-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/202608101641260FC6020592024BCCC24D-9605-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437692&x-signature=aVxFAe4eN2JCGiHqS1uqt2gNQhg%3D'],
  ['guishuxiaochou', 'https://p9-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/202608101641381124C7D007B9A2CEEB02-2655-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437705&x-signature=ByLam8KUKqDXt3r%2FnuZCJd1tBPs%3D'],
  ['jingguan', 'https://p9-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/2026081016415046E14E0806DDEB59A2BD-5904-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1786437717&x-signature=wVDrTRJ3R%2BbwWBl6yuiSRu1vqkI%3D']
];

(async () => {
  for (const [id, url] of items) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(dir, id + '.png'), buf);
      console.log('OK', id, buf.length + ' bytes');
    } catch (e) {
      console.log('FAIL', id, e.message);
    }
  }
  console.log('done ->', dir);
})();
