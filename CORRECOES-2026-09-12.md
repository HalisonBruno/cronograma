# Correções pedagógicas e de planejamento - 12/09/2026

## Perfil de estudo

- Base de 120 minutos por dia, somente de segunda a sexta-feira.
- Questões permanecem fora desse limite.
- Margem pedagógica máxima de 15 minutos, usada apenas para terminar um capítulo curto que ultrapasse a sessão ou o último bloco de uma mesma sequência de lei seca já iniciada naquele dia.
- Todo uso da margem fica registrado no plano e explicado na página do dia.
- Prioridades e incidências provenientes dos levantamentos FGV/CEBRASPE não foram alteradas.

## Replanejamento e capacidade

O botão **Replanejar** recolhe todas as atividades futuras ainda pendentes, preserva integralmente as conclusões e remonta os dias úteis. Informativos têm reserva obrigatória. Questões não consomem a capacidade diária.

A fila antiga foi substituída por um painel paginado de **Pendências sem data**. Ele mostra todos os itens, o motivo de cada pendência e duas ações:

1. replanejar dentro do horizonte ENAM 2027.1;
2. gerar uma prévia de continuidade, com a data necessária para encaixar tudo.

Aplicar a continuidade é uma decisão expressa: a data de prova não é alterada e o aplicativo avisa que as atividades posteriores não servem para a preparação daquela edição.

### Simulação com a cópia do progresso sincronizado

Estado consultado somente por leitura, atualizado em **12/09/2026 às 20:02 (Brasília)**:

- 354 blocos cobertos no novo contador: 325 marcações diretas, 1 cobertura por bloco completo e 28 equivalências válidas;
- 330 registros manuais de estudo preservados byte a byte, inclusive seus horários;
- até 16/04/2027: 2.078 atividades recebem data, 326 ficam explicitamente sem capacidade e 114 são alternativas ou sessões especiais;
- 1.636 informativos ainda pendentes: 1.628 leituras recebem data e 8 itens são cobertos por duplicidade comprovada entre os próprios informativos; nenhum é cortado;
- carga diária máxima: 134 minutos, em apenas dois dias com justificativa pedagógica; os demais respeitam 120 minutos;
- a prévia para encaixar toda a demanda termina em **25/08/2027**, com 2.404 atividades datadas, nenhuma pendência de capacidade e nenhum fim de semana ocupado.

Esses números são uma fotografia de teste e mudam conforme novas conclusões. A prévia foi executada em memória: nenhum dado sincronizado foi regravado durante a auditoria.

## Equivalências

- Aula e capítulo integralmente equivalentes continuam bidirecionais: concluir um marca os dois blocos.
- Os minutos são registrados apenas no material efetivamente estudado.
- Vídeo nunca comprova leitura de lei seca, nem pela cadeia vídeo -> e-book -> lei.
- Uma associação temática entre bloco legal e material teórico não gera equivalência.
- Fragmentos diferentes do mesmo artigo não são tratados como o mesmo texto.
- Estados automáticos sem suporte são eliminados; marcações manuais e horários permanecem intactos.

## Conferência e-book -> lei seca

Os 14 e-books locais, 203 capítulos e 467 grupos legais cadastrados foram comparados por texto integral. A normalização aceita apenas diferenças tipográficas; não usa semelhança temática, paráfrase ou correspondência aproximada. Sete grupos visíveis ficaram comprovados dentro de um único capítulo:

- Penal Especial, capítulo 7: Lei 13.869, art. 1º;
- Administrativo, capítulo 15: Lei 9.784, arts. 5º a 8º;
- Empresarial, capítulo 11: Lei 13.966, art. 2º, caput e incisos I a XIV;
- Tributário, capítulo 14: Lei 6.830, art. 40;
- Tributário, capítulo 15: Constituição, art. 153, § 6º, incisos I a VII;
- Tributário, capítulo 16: Constituição, art. 155, § 6º, incisos II e III e alíneas;
- Processo Penal, capítulo 5: CPP, art. 28.

Os outros 460 grupos não recebem equivalência automática. “Não comprovado” não significa que o dispositivo inexista no livro; significa apenas que o texto integral exigido pelo bloco não foi demonstrado no intervalo de um capítulo pelo método conservador.

O manifesto auditável está em `ebook-law-evidence.json`; a versão mínima usada pelo aplicativo está em `ebook-law-evidence.js`. O gerador reproduzível está em `scripts/verify-ebook-law-evidence.py`. Essa conferência atesta correspondência textual, não substitui a auditoria de vigência legislativa registrada em `AUDITORIA-2026-09-11.md`.

## Contadores

O cabeçalho não apresenta mais uma fração ambígua. Ele separa:

- blocos concluídos;
- pendências com data útil, de hoje em diante;
- minutos efetivamente estudados hoje;
- acervo total, exibido apenas na explicação detalhada.

O acervo inclui alternativas, aulas, capítulos, jurisprudências, informativos e revisões geradas. Por isso, seu tamanho não é apresentado como quantidade de tarefas obrigatórias do plano.

## Recuperação

Antes da migração para 120 minutos, o navegador cria uma cópia local integral do estado, sem o código de sincronização. Ela pode ser baixada em **Ajustes -> Exportar backup anterior à mudança de 120 min**. O replanejamento também mantém a ação **Desfazer último replanejamento**.
