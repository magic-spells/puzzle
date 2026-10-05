import Page from './views/Page.pzl';
import Product from './views/Product.pzl';

export default [
	{ path: '/', view: Page },
	{ path: '/about', view: Page },
	{ path: '/product/:id', view: Product },
];
