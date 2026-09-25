# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/cadencia-modal.test.js >> Cadência Modal Flow >> should scroll content when modal is tall
- Location: tests/cadencia-modal.test.js:94:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.admin-member-body')
Expected: visible
Error: strict mode violation: locator('.admin-member-body') resolved to 5 elements:
    1) <div class="modal-body admin-member-body">…</div> aka getByText('Dados da Empresa Nome da Empresa * Vínculo de Serviços Marque os serviços que')
    2) <div class="modal-body admin-member-body">…</div> aka locator('div').filter({ hasText: 'Dados do Serviço Nome do' }).nth(3)
    3) <div class="modal-body admin-member-body">…</div> aka locator('div').filter({ hasText: 'Dados da Cadência Nome da Cad' }).nth(3)
    4) <div class="modal-body admin-member-body">…</div> aka locator('div').filter({ hasText: 'Dados de Acesso * Nome * E-' }).nth(2)
    5) <div class="modal-body admin-member-body">…</div> aka locator('div').filter({ hasText: 'Lead Vinculado * Selecionar' }).nth(1)

Call log:
  - Expect "toBeVisible" locator('.admin-member-body') with timeout 5000ms
  - waiting for locator('.admin-member-body')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic:
    - generic:
      - generic:
        - img "Blue Group"
        - paragraph: Acesse sua conta para gerenciar o CRM.
      - generic:
        - generic:
          - generic: E-mail
          - generic:
            - textbox "E-mail":
              - /placeholder: seu@email.com
              - text: ph102126@gmail.com
        - generic:
          - generic: Senha
          - generic:
            - textbox "Senha":
              - /placeholder: Sua senha
              - text: 102126pedro
            - button "Mostrar senha"
        - generic:
          - generic:
            - checkbox "Lembrar de mim"
            - generic: Lembrar de mim
          - link "Esqueceu a senha?":
            - /url: "#"
        - button "Entrar"
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - img "Blue Group" [ref=e5]
      - navigation [ref=e6]:
        - paragraph [ref=e7]: Principal
        - list [ref=e8]:
          - listitem [ref=e9]:
            - link "Home" [ref=e10] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e15]:
            - link "Dashboard" [ref=e16] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e23]:
            - link "CRM" [ref=e24] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e28]:
            - link "Conversas" [ref=e29] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e33]:
            - link "Contratos" [ref=e34] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e39]:
            - link "Cliente da Base" [ref=e40] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e47]:
            - link "Calendário" [ref=e48] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e52]:
            - link "Rotina Blue" [ref=e53] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e58]:
            - link "Pomodoro" [ref=e59] [cursor=pointer]:
              - /url: "#"
        - paragraph [ref=e64]: Ferramentas
        - list [ref=e65]:
          - listitem [ref=e66]:
            - link "Configurações" [ref=e67] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e72]:
            - link "Auditoria" [ref=e73] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e77]:
            - link "Administrador" [ref=e78] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e83]:
            - link "Calibragem" [ref=e84] [cursor=pointer]:
              - /url: "#"
      - generic [ref=e90]:
        - paragraph [ref=e93]: Pedro Casttrini
        - button "Sair" [ref=e94] [cursor=pointer]
    - main [ref=e98]:
      - generic [ref=e99]:
        - generic [ref=e100]:
          - button "Menu" [ref=e101] [cursor=pointer]
          - heading "Administrador" [level=1] [ref=e104]
        - generic [ref=e105]:
          - button "Ativar tema escuro" [ref=e106] [cursor=pointer]
          - button "Notificações" [ref=e109] [cursor=pointer]
      - generic [ref=e114]:
        - text: ✓ ✓ ✓ ✓
        - generic [ref=e115]:
          - generic [ref=e116]:
            - generic [ref=e117]:
              - heading "Administrador" [level=2] [ref=e118]
              - paragraph [ref=e122]: Gerencie membros e permissões do sistema
            - button "Novo Membro" [ref=e123] [cursor=pointer]
          - generic [ref=e125]:
            - button "Membros" [ref=e126] [cursor=pointer]
            - button "Permissões" [ref=e132] [cursor=pointer]
            - button "Empresas" [ref=e135] [cursor=pointer]
            - button "Serviços" [ref=e140] [cursor=pointer]
            - button "Cadências" [ref=e144] [cursor=pointer]
          - generic [ref=e147]:
            - generic [ref=e148]:
              - paragraph [ref=e150]: Gerencie as cadências (etapas do funil) do CRM. Arraste para reordenar.
              - button "Nova Cadência" [active] [ref=e151] [cursor=pointer]
            - generic [ref=e154]:
              - generic [ref=e155]:
                - button "Arraste para reordenar" [ref=e156]
                - generic [ref=e165]: Dados IA
                - generic [ref=e166]: "1"
                - generic [ref=e167]:
                  - button "Editar" [ref=e168] [cursor=pointer]
                  - button "Excluir" [ref=e172] [cursor=pointer]
              - generic [ref=e176]:
                - button "Arraste para reordenar" [ref=e177]
                - generic [ref=e186]: Novo lead
                - generic [ref=e187]: "2"
                - generic [ref=e188]:
                  - button "Editar" [ref=e189] [cursor=pointer]
                  - button "Excluir" [ref=e193] [cursor=pointer]
              - generic [ref=e197]:
                - button "Arraste para reordenar" [ref=e198]
                - generic [ref=e207]: Coletados Frios
                - generic [ref=e208]: "3"
                - generic [ref=e209]:
                  - button "Editar" [ref=e210] [cursor=pointer]
                  - button "Excluir" [ref=e214] [cursor=pointer]
              - generic [ref=e218]:
                - button "Arraste para reordenar" [ref=e219]
                - generic [ref=e228]: Qualificado IA
                - generic [ref=e229]: "4"
                - generic [ref=e230]:
                  - button "Editar" [ref=e231] [cursor=pointer]
                  - button "Excluir" [ref=e235] [cursor=pointer]
              - generic [ref=e239]:
                - button "Arraste para reordenar" [ref=e240]
                - generic [ref=e249]: Aguardando Resposta
                - generic [ref=e250]: "5"
                - generic [ref=e251]:
                  - button "Editar" [ref=e252] [cursor=pointer]
                  - button "Excluir" [ref=e256] [cursor=pointer]
              - generic [ref=e260]:
                - button "Arraste para reordenar" [ref=e261]
                - generic [ref=e270]: Em Atendimento
                - generic [ref=e271]: "6"
                - generic [ref=e272]:
                  - button "Editar" [ref=e273] [cursor=pointer]
                  - button "Excluir" [ref=e277] [cursor=pointer]
              - generic [ref=e281]:
                - button "Arraste para reordenar" [ref=e282]
                - generic [ref=e291]: Follow-up 1
                - generic [ref=e292]: "7"
                - generic [ref=e293]:
                  - button "Editar" [ref=e294] [cursor=pointer]
                  - button "Excluir" [ref=e298] [cursor=pointer]
              - generic [ref=e302]:
                - button "Arraste para reordenar" [ref=e303]
                - generic [ref=e312]: Follow-up 2
                - generic [ref=e313]: "8"
                - generic [ref=e314]:
                  - button "Editar" [ref=e315] [cursor=pointer]
                  - button "Excluir" [ref=e319] [cursor=pointer]
              - generic [ref=e323]:
                - button "Arraste para reordenar" [ref=e324]
                - generic [ref=e333]: Follow-up 3
                - generic [ref=e334]: "9"
                - generic [ref=e335]:
                  - button "Editar" [ref=e336] [cursor=pointer]
                  - button "Excluir" [ref=e340] [cursor=pointer]
              - generic [ref=e344]:
                - button "Arraste para reordenar" [ref=e345]
                - generic [ref=e354]: Follow-up 4
                - generic [ref=e355]: "10"
                - generic [ref=e356]:
                  - button "Editar" [ref=e357] [cursor=pointer]
                  - button "Excluir" [ref=e361] [cursor=pointer]
              - generic [ref=e365]:
                - button "Arraste para reordenar" [ref=e366]
                - generic [ref=e375]: Parceiros
                - generic [ref=e376]: "11"
                - generic [ref=e377]:
                  - button "Editar" [ref=e378] [cursor=pointer]
                  - button "Excluir" [ref=e382] [cursor=pointer]
              - generic [ref=e386]:
                - button "Arraste para reordenar" [ref=e387]
                - generic [ref=e396]: Standy-by
                - generic [ref=e397]: "12"
                - generic [ref=e398]:
                  - button "Editar" [ref=e399] [cursor=pointer]
                  - button "Excluir" [ref=e403] [cursor=pointer]
              - generic [ref=e407]:
                - button "Arraste para reordenar" [ref=e408]
                - generic [ref=e417]: Geladeira
                - generic [ref=e418]: "13"
                - generic [ref=e419]:
                  - button "Editar" [ref=e420] [cursor=pointer]
                  - button "Excluir" [ref=e424] [cursor=pointer]
              - generic [ref=e428]:
                - button "Arraste para reordenar" [ref=e429]
                - generic [ref=e438]: Acompanhamento
                - generic [ref=e439]: "14"
                - generic [ref=e440]:
                  - button "Editar" [ref=e441] [cursor=pointer]
                  - button "Excluir" [ref=e445] [cursor=pointer]
              - generic [ref=e449]:
                - button "Arraste para reordenar" [ref=e450]
                - generic [ref=e459]: Geração de Contrato
                - generic [ref=e460]: "15"
                - generic [ref=e461]:
                  - button "Editar" [ref=e462] [cursor=pointer]
                  - button "Excluir" [ref=e466] [cursor=pointer]
              - generic [ref=e470]:
                - button "Arraste para reordenar" [ref=e471]
                - generic [ref=e480]: Contrato Enviado
                - generic [ref=e481]: "16"
                - generic [ref=e482]:
                  - button "Editar" [ref=e483] [cursor=pointer]
                  - button "Excluir" [ref=e487] [cursor=pointer]
              - generic [ref=e491]:
                - button "Arraste para reordenar" [ref=e492]
                - generic [ref=e501]: Contrato Fechado
                - generic [ref=e502]: "17"
                - generic [ref=e503]:
                  - button "Editar" [ref=e504] [cursor=pointer]
                  - button "Excluir" [ref=e508] [cursor=pointer]
            - paragraph [ref=e514]: Configure quais perfis podem visualizar cada cadência no CRM.
            - table [ref=e516]:
              - rowgroup [ref=e517]:
                - row [ref=e518]:
                  - columnheader "Cadência" [ref=e519]
                  - columnheader "Administrador" [ref=e520]
                  - columnheader "Membro" [ref=e521]
                  - columnheader "Pré Vendas" [ref=e522]
                  - columnheader "Atendente" [ref=e523]
              - rowgroup [ref=e524]:
                - row [ref=e525]:
                  - cell [ref=e526]:
                    - strong [ref=e527]: Dados IA
                  - cell [ref=e528]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e529]
                  - cell [ref=e530]:
                    - checkbox [checked] [ref=e531]
                  - cell [ref=e532]:
                    - checkbox [checked] [ref=e533]
                  - cell [ref=e534]:
                    - checkbox [checked] [ref=e535]
                - row [ref=e536]:
                  - cell [ref=e537]:
                    - strong [ref=e538]: Novo lead
                  - cell [ref=e539]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e540]
                  - cell [ref=e541]:
                    - checkbox [checked] [ref=e542]
                  - cell [ref=e543]:
                    - checkbox [checked] [ref=e544]
                  - cell [ref=e545]:
                    - checkbox [checked] [ref=e546]
                - row [ref=e547]:
                  - cell [ref=e548]:
                    - strong [ref=e549]: Coletados Frios
                  - cell [ref=e550]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e551]
                  - cell [ref=e552]:
                    - checkbox [checked] [ref=e553]
                  - cell [ref=e554]:
                    - checkbox [checked] [ref=e555]
                  - cell [ref=e556]:
                    - checkbox [checked] [ref=e557]
                - row [ref=e558]:
                  - cell [ref=e559]:
                    - strong [ref=e560]: Qualificado IA
                  - cell [ref=e561]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e562]
                  - cell [ref=e563]:
                    - checkbox [checked] [ref=e564]
                  - cell [ref=e565]:
                    - checkbox [checked] [ref=e566]
                  - cell [ref=e567]:
                    - checkbox [checked] [ref=e568]
                - row [ref=e569]:
                  - cell [ref=e570]:
                    - strong [ref=e571]: Aguardando Resposta
                  - cell [ref=e572]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e573]
                  - cell [ref=e574]:
                    - checkbox [checked] [ref=e575]
                  - cell [ref=e576]:
                    - checkbox [checked] [ref=e577]
                  - cell [ref=e578]:
                    - checkbox [checked] [ref=e579]
                - row [ref=e580]:
                  - cell [ref=e581]:
                    - strong [ref=e582]: Em Atendimento
                  - cell [ref=e583]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e584]
                  - cell [ref=e585]:
                    - checkbox [checked] [ref=e586]
                  - cell [ref=e587]:
                    - checkbox [checked] [ref=e588]
                  - cell [ref=e589]:
                    - checkbox [checked] [ref=e590]
                - row [ref=e591]:
                  - cell [ref=e592]:
                    - strong [ref=e593]: Follow-up 1
                  - cell [ref=e594]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e595]
                  - cell [ref=e596]:
                    - checkbox [checked] [ref=e597]
                  - cell [ref=e598]:
                    - checkbox [checked] [ref=e599]
                  - cell [ref=e600]:
                    - checkbox [checked] [ref=e601]
                - row [ref=e602]:
                  - cell [ref=e603]:
                    - strong [ref=e604]: Follow-up 2
                  - cell [ref=e605]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e606]
                  - cell [ref=e607]:
                    - checkbox [checked] [ref=e608]
                  - cell [ref=e609]:
                    - checkbox [checked] [ref=e610]
                  - cell [ref=e611]:
                    - checkbox [checked] [ref=e612]
                - row [ref=e613]:
                  - cell [ref=e614]:
                    - strong [ref=e615]: Follow-up 3
                  - cell [ref=e616]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e617]
                  - cell [ref=e618]:
                    - checkbox [checked] [ref=e619]
                  - cell [ref=e620]:
                    - checkbox [checked] [ref=e621]
                  - cell [ref=e622]:
                    - checkbox [checked] [ref=e623]
                - row [ref=e624]:
                  - cell [ref=e625]:
                    - strong [ref=e626]: Follow-up 4
                  - cell [ref=e627]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e628]
                  - cell [ref=e629]:
                    - checkbox [checked] [ref=e630]
                  - cell [ref=e631]:
                    - checkbox [checked] [ref=e632]
                  - cell [ref=e633]:
                    - checkbox [checked] [ref=e634]
                - row [ref=e635]:
                  - cell [ref=e636]:
                    - strong [ref=e637]: Parceiros
                  - cell [ref=e638]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e639]
                  - cell [ref=e640]:
                    - checkbox [checked] [ref=e641]
                  - cell [ref=e642]:
                    - checkbox [checked] [ref=e643]
                  - cell [ref=e644]:
                    - checkbox [checked] [ref=e645]
                - row [ref=e646]:
                  - cell [ref=e647]:
                    - strong [ref=e648]: Standy-by
                  - cell [ref=e649]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e650]
                  - cell [ref=e651]:
                    - checkbox [checked] [ref=e652]
                  - cell [ref=e653]:
                    - checkbox [checked] [ref=e654]
                  - cell [ref=e655]:
                    - checkbox [checked] [ref=e656]
                - row [ref=e657]:
                  - cell [ref=e658]:
                    - strong [ref=e659]: Geladeira
                  - cell [ref=e660]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e661]
                  - cell [ref=e662]:
                    - checkbox [checked] [ref=e663]
                  - cell [ref=e664]:
                    - checkbox [checked] [ref=e665]
                  - cell [ref=e666]:
                    - checkbox [checked] [ref=e667]
                - row [ref=e668]:
                  - cell [ref=e669]:
                    - strong [ref=e670]: Acompanhamento
                  - cell [ref=e671]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e672]
                  - cell [ref=e673]:
                    - checkbox [checked] [ref=e674]
                  - cell [ref=e675]:
                    - checkbox [checked] [ref=e676]
                  - cell [ref=e677]:
                    - checkbox [checked] [ref=e678]
                - row [ref=e679]:
                  - cell [ref=e680]:
                    - strong [ref=e681]: Geração de Contrato
                  - cell [ref=e682]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e683]
                  - cell [ref=e684]:
                    - checkbox [checked] [ref=e685]
                  - cell [ref=e686]:
                    - checkbox [checked] [ref=e687]
                  - cell [ref=e688]:
                    - checkbox [checked] [ref=e689]
                - row [ref=e690]:
                  - cell [ref=e691]:
                    - strong [ref=e692]: Contrato Enviado
                  - cell [ref=e693]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e694]
                  - cell [ref=e695]:
                    - checkbox [checked] [ref=e696]
                  - cell [ref=e697]:
                    - checkbox [checked] [ref=e698]
                  - cell [ref=e699]:
                    - checkbox [checked] [ref=e700]
                - row [ref=e701]:
                  - cell [ref=e702]:
                    - strong [ref=e703]: Contrato Fechado
                  - cell [ref=e704]:
                    - checkbox "Administrador sempre vê todas" [checked] [disabled] [ref=e705]
                  - cell [ref=e706]:
                    - checkbox [checked] [ref=e707]
                  - cell [ref=e708]:
                    - checkbox [checked] [ref=e709]
                  - cell [ref=e710]:
                    - checkbox [checked] [ref=e711]
          - dialog [ref=e713]:
            - generic [ref=e714]:
              - generic [ref=e719]:
                - heading "Nova Cadência" [level=2] [ref=e720]
                - paragraph [ref=e721]: Cadastre uma nova etapa do funil
              - button "Fechar" [ref=e722] [cursor=pointer]
            - generic [ref=e727]:
              - heading "Dados da Cadência" [level=3] [ref=e728]
              - generic [ref=e729]:
                - generic [ref=e730]:
                  - generic [ref=e731]: Nome da Cadência *
                  - 'textbox "Ex: Qualificado" [ref=e732]'
                - generic [ref=e733]:
                  - generic [ref=e734]: Cor *
                  - radiogroup "Cor da cadência" [ref=e735]:
                    - radio "Azul" [checked] [ref=e736] [cursor=pointer]: ✓
                    - radio "Vermelho" [ref=e737] [cursor=pointer]
                    - radio "Laranja" [ref=e738] [cursor=pointer]
                    - radio "Amarelo" [ref=e739] [cursor=pointer]
                    - radio "Verde" [ref=e740] [cursor=pointer]
                    - radio "Azul claro" [ref=e741] [cursor=pointer]
                    - radio "Azul escuro" [ref=e742] [cursor=pointer]
                    - radio "Roxo" [ref=e743] [cursor=pointer]
                    - radio "Cinza" [ref=e744] [cursor=pointer]
                    - radio "Rosa" [ref=e745] [cursor=pointer]
                    - radio "Teal" [ref=e746] [cursor=pointer]
                    - radio "Laranja escuro" [ref=e747] [cursor=pointer]
                    - radio "Lima" [ref=e748] [cursor=pointer]
            - generic [ref=e749]:
              - heading "Visibilidade por Perfil" [level=3] [ref=e750]
              - paragraph [ref=e751]: Marque quais perfis podem visualizar esta cadência no CRM
              - generic [ref=e752]:
                - generic [ref=e753]:
                  - checkbox "Administrador" [checked] [disabled] [ref=e754] [cursor=pointer]
                  - generic [ref=e755]: Administrador
                - generic [ref=e756] [cursor=pointer]:
                  - checkbox "Membro" [checked] [ref=e757]
                  - generic [ref=e758]: Membro
                - generic [ref=e759] [cursor=pointer]:
                  - checkbox "Pré Vendas" [checked] [ref=e760]
                  - generic [ref=e761]: Pré Vendas
                - generic [ref=e762] [cursor=pointer]:
                  - checkbox "Atendente" [checked] [ref=e763]
                  - generic [ref=e764]: Atendente
          - generic [ref=e765]:
            - paragraph [ref=e766]: A cadência será salva no Supabase e aparecerá no CRM.
            - generic [ref=e767]:
              - button "Cancelar" [ref=e768] [cursor=pointer]
              - button "Salvar Cadência" [ref=e769] [cursor=pointer]
  - complementary [ref=e775]:
    - generic [ref=e776]:
      - generic [ref=e777]:
        - generic [ref=e778]: TS
        - generic [ref=e779]:
          - heading "Tech Solutions LTDA" [level=3] [ref=e780]
          - paragraph [ref=e781]: 12.345.678/0001-90
      - button [ref=e782] [cursor=pointer]
    - generic [ref=e786]:
      - button "Visão geral" [ref=e787] [cursor=pointer]
      - button "Documentos" [ref=e788] [cursor=pointer]
      - button "Histórico" [ref=e789] [cursor=pointer]
      - button "Obrigações" [ref=e790] [cursor=pointer]
    - generic [ref=e791]:
      - generic [ref=e792]:
        - generic [ref=e793]:
          - paragraph [ref=e794]: Regime
          - paragraph [ref=e795]: Lucro Presumido
        - generic [ref=e796]:
          - paragraph [ref=e797]: Status
          - paragraph [ref=e798]:
            - generic [ref=e799]: Ativo
        - generic [ref=e800]:
          - paragraph [ref=e801]: Responsável
          - paragraph [ref=e802]: Camila Souza
        - generic [ref=e803]:
          - paragraph [ref=e804]: Cliente desde
          - paragraph [ref=e805]: Mar/2022
      - heading "Situação fiscal/contábil" [level=4] [ref=e806]
      - generic [ref=e807]:
        - generic [ref=e812]:
          - paragraph [ref=e813]: Certidões negativas
          - text: Regular · vence em 45 dias
        - generic [ref=e817]:
          - paragraph [ref=e818]: SPED Contribuições
          - text: Pendente · vence 10/06
        - generic [ref=e823]:
          - paragraph [ref=e824]: Folha de pagamento
          - text: Em dia · próxima em 05/06
        - generic [ref=e829]:
          - paragraph [ref=e830]: Conciliação bancária
          - text: Concluída · 100%
      - heading "Histórico de interações" [level=4] [ref=e831]
      - list [ref=e832]:
        - listitem [ref=e833]:
          - generic [ref=e835]:
            - paragraph [ref=e836]: Reunião de fechamento · Abril
            - paragraph [ref=e837]: 28/04/2026 · 45 min · com João Silva
            - paragraph [ref=e838]: Apresentados resultados do trimestre e alinhamento de estratégias tributárias.
        - listitem [ref=e839]:
          - generic [ref=e841]:
            - paragraph [ref=e842]: E-mail · Documentos recebidos
            - paragraph [ref=e843]: 22/04/2026 · Notas fiscais de abril
            - paragraph [ref=e844]: Cliente enviou XMLs de NF-e para conciliação.
        - listitem [ref=e845]:
          - generic [ref=e847]:
            - paragraph [ref=e848]: Ligação · Planejamento tributário
            - paragraph [ref=e849]: 15/04/2026 · 20 min · com a sócia Ana
            - paragraph [ref=e850]: Avaliação de mudança de regime para 2027.
        - listitem [ref=e851]:
          - generic [ref=e853]:
            - paragraph [ref=e854]: Entrega · ECF 2025
            - paragraph [ref=e855]: 10/04/2026 · Sistema
            - paragraph [ref=e856]: Obrigação entregue no prazo com sucesso.
  - text: Este lead espelha o registro em Clientes da Base
```

# Test source

```ts
  4   |   test.beforeEach(async ({ page }) => {
  5   |     await page.goto('http://localhost:5173');
  6   |     // Wait for app to load
  7   |     await page.waitForLoadState('networkidle');
  8   |     
  9   |     // Navigate to Administrador tab
  10  |     await page.click('text=Administrador');
  11  |     await page.waitForTimeout(500);
  12  |     
  13  |     // Click Cadências tab
  14  |     await page.click('[data-admin-tab="cadencias"]');
  15  |     await page.waitForTimeout(500);
  16  |   });
  17  | 
  18  |   test('should open modal and show validation error when name is empty', async ({ page }) => {
  19  |     // Click Nova Cadência button
  20  |     await page.click('#cadenciaNewBtn');
  21  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  22  |     
  23  |     // Verify modal is open
  24  |     await expect(page.locator('#cadenciaModal')).toBeVisible();
  25  |     await expect(page.locator('#cadenciaModalTitle')).toHaveText('Nova Cadência');
  26  |     
  27  |     // Click Salvar Cadência without filling name
  28  |     await page.click('#cadenciaSaveBtn');
  29  |     
  30  |     // Should show toast error
  31  |     await expect(page.locator('.toast')).toBeVisible();
  32  |     await expect(page.locator('.toast')).toContainText('Preencha o nome da cadência');
  33  |     
  34  |     // Should show inline validation error
  35  |     await expect(page.locator('#cadenciaNomeInput')).toHaveClass(/invalid/);
  36  |     await expect(page.locator('#cadenciaNomeError')).toBeVisible();
  37  |     await expect(page.locator('#cadenciaNomeError')).toHaveText('O nome da cadência é obrigatório');
  38  |   });
  39  | 
  40  |   test('should create cadência with valid data', async ({ page }) => {
  41  |     // Click Nova Cadência button
  42  |     await page.click('#cadenciaNewBtn');
  43  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  44  |     
  45  |     // Fill name
  46  |     await page.fill('#cadenciaNomeInput', 'Teste Cadência E2E');
  47  |     
  48  |     // Select a color (click second color swatch)
  49  |     await page.click('#cadenciaColorPicker .color-swatch:nth-child(2)');
  50  |     
  51  |     // Click Salvar Cadência
  52  |     await page.click('#cadenciaSaveBtn');
  53  |     
  54  |     // Wait for toast success
  55  |     await expect(page.locator('.toast')).toBeVisible();
  56  |     await expect(page.locator('.toast')).toContainText('Cadência criada com sucesso');
  57  |     
  58  |     // Modal should close
  59  |     await expect(page.locator('#cadenciaModal')).not.toHaveClass(/open/);
  60  |     
  61  |     // Verify cadência appears in list
  62  |     await expect(page.locator('#cadenciaList .cadencia-name')).toContainText('Teste Cadência E2E');
  63  |   });
  64  | 
  65  |   test('should have visible buttons on mobile viewport', async ({ page }) => {
  66  |     // Set mobile viewport
  67  |     await page.setViewportSize({ width: 375, height: 667 });
  68  |     
  69  |     // Click Nova Cadência button
  70  |     await page.click('#cadenciaNewBtn');
  71  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  72  |     
  73  |     // Verify modal is full width on mobile
  74  |     const modal = page.locator('#cadenciaModal');
  75  |     await expect(modal).toBeVisible();
  76  |     
  77  |     // Verify footer buttons are visible and stacked
  78  |     const cancelBtn = page.locator('[data-action="close-cadencia-modal"]');
  79  |     const saveBtn = page.locator('#cadenciaSaveBtn');
  80  |     
  81  |     await expect(cancelBtn).toBeVisible();
  82  |     await expect(saveBtn).toBeVisible();
  83  |     
  84  |     // Buttons should be full width on mobile
  85  |     const cancelBox = await cancelBtn.boundingBox();
  86  |     const saveBox = await saveBtn.boundingBox();
  87  |     const modalBox = await modal.boundingBox();
  88  |     
  89  |     // Buttons should be nearly full width of modal (within 20px margin)
  90  |     expect(cancelBox.width).toBeGreaterThan(modalBox.width - 40);
  91  |     expect(saveBox.width).toBeGreaterThan(modalBox.width - 40);
  92  |   });
  93  | 
  94  |   test('should scroll content when modal is tall', async ({ page }) => {
  95  |     // Set small height viewport
  96  |     await page.setViewportSize({ width: 400, height: 500 });
  97  |     
  98  |     // Click Nova Cadência button
  99  |     await page.click('#cadenciaNewBtn');
  100 |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  101 |     
  102 |     // Verify modal body is scrollable
  103 |     const modalBody = page.locator('.admin-member-body');
> 104 |     await expect(modalBody).toBeVisible();
      |                             ^ Error: expect(locator).toBeVisible() failed
  105 |     
  106 |     // The visibility checkboxes section should be scrollable into view
  107 |     const visibilitySection = page.locator('#cadenciaVisibilidadeChecks');
  108 |     await expect(visibilitySection).toBeVisible();
  109 |     
  110 |     // Footer should still be visible
  111 |     const footer = page.locator('.admin-member-foot');
  112 |     await expect(footer).toBeVisible();
  113 |   });
  114 | });
```