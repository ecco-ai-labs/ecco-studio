const logo = new URL('../logo-transparent.png', import.meta.url).href;

export default function Brand({markOnly=false}:{markOnly?:boolean}){
 return <div className="ecco-brand"><img className="ecco-logo" src={logo} alt="Ecco AI Labs logo" width={46} height={46}/>{!markOnly&&<div className="ecco-wordmark">Ecco AI Labs<small>Ecco Desk</small></div>}</div>;
}
